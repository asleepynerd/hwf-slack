const axios = require("axios");

class FirebaseClient {
  constructor() {
    this.projectId = process.env.FIREBASE_PROJECT_ID;
    this.webApiKey = process.env.FIREBASE_WEB_API_KEY;
    this.refreshToken = process.env.FIREBASE_REFRESH_TOKEN;
    this.cachedAuth = null;
    this.authExpiry = null;
  }

  async getFirebaseIdToken() {
    if (
      this.cachedAuth &&
      this.authExpiry &&
      Date.now() < this.authExpiry - 300000
    ) {
      return this.cachedAuth;
    }
    const tokenUrl = `https://securetoken.googleapis.com/v1/token?key=${this.webApiKey}`;
    const payload = {
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    };
    try {
      const response = await axios.post(tokenUrl, payload);
      const tokenData = response.data;
      this.cachedAuth = {
        id_token: tokenData.id_token,
        user_id: tokenData.user_id,
      };
      this.authExpiry = Date.now() + 3600 * 1000;
      return this.cachedAuth;
    } catch (error) {
      console.error(
        "error refreshing firebase token:",
        error.response?.data || error.message
      );
      return null;
    }
  }

  async lookupUserByCode(friendCode) {
    const authInfo = await this.getFirebaseIdToken();
    if (!authInfo) return null;
    const cloudFunctionUrl = `https://us-central1-${this.projectId}.cloudfunctions.net/getUserCode`;
    const headers = {
      Authorization: `Bearer ${authInfo.id_token}`,
      "Content-Type": "application/json",
    };
    const payload = { data: { code: friendCode } };
    try {
      const response = await axios.post(cloudFunctionUrl, payload, { headers });
      return response.data.result?.user || null;
    } catch (error) {
      console.error(
        "error looking up friend code:",
        error.response?.data || error.message
      );
      return null;
    }
  }

  async sendFriendRequest(friendInfo) {
    const authInfo = await this.getFirebaseIdToken();
    if (!authInfo || !friendInfo) return null;
    const createDocUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/groups`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authInfo.id_token}`,
    };
    const myUid = authInfo.user_id;
    const friendUid = friendInfo.uid;
    const nowUtc = new Date();
    const pendingGroupData = {
      name: "",
      memberIds: [myUid, friendUid],
      checkIns: {},
      createdAt: nowUtc,
      modifiedAt: nowUtc,
      membership: {
        [myUid]: {
          id: myUid,
          name: "hwfbot",
          imagePath: "",
          accepted: true,
          checkInCount: 0,
          createdAt: nowUtc,
          modifiedAt: nowUtc,
        },
        [friendUid]: {
          id: friendUid,
          name: friendInfo.name,
          imagePath: friendInfo.imagePath || "",
          accepted: false,
          checkInCount: 0,
          createdAt: nowUtc,
          modifiedAt: nowUtc,
        },
      },
    };
    const firestorePayload = {
      fields: this.formatForFirestore(pendingGroupData, true),
    };
    try {
      const response = await axios.post(createDocUrl, firestorePayload, {
        headers,
      });
      const newDocName = response.data.name;
      const groupId = newDocName.split("/").pop();
      return groupId;
    } catch (error) {
      console.error(
        "error creating friendship document:",
        error.response?.data || error.message
      );
      return null;
    }
  }

  async getFriendsData() {
    const authInfo = await this.getFirebaseIdToken();
    if (!authInfo) return [];

    const queryUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents:runQuery`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authInfo.id_token}`,
    };
    const queryPayload = {
      structuredQuery: {
        from: [{ collectionId: "groups" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "memberIds" },
            op: "ARRAY_CONTAINS",
            value: { stringValue: authInfo.user_id },
          },
        },
      },
    };

    try {
      const response = await axios.post(queryUrl, queryPayload, { headers });
      const results = response.data || [];
      const friendsData = [];

      for (const item of results) {
        if (!item.document) continue;

        const groupId = item.document.name.split("/").pop();
        const groupData = this.parseFirestoreDocument(item.document);
        const membershipData = groupData.membership || {};
        const checkinsData = groupData.checkIns || {};

        for (const [memberId, memberInfo] of Object.entries(membershipData)) {
          if (memberId === authInfo.user_id) continue;

          const friendCheckin = checkinsData[memberId];
          friendsData.push({
            groupId,
            friendId: memberId,
            friendName: memberInfo.name || "N/A",
            accepted: memberInfo.accepted,
            moods: friendCheckin?.moodNames || [],
            note: friendCheckin?.note || "",
            hasCheckin: !!friendCheckin,
            checkinId: friendCheckin?.id || null,
          });
        }
      }
      return friendsData;
    } catch (error) {
      console.error(
        "fuck you firebase:",
        error.response?.data || error.message
      );
      return [];
    }
  }

  async pollFriendAcceptance(
    authInfo,
    groupId,
    friendUid,
    maxWaitMs = 300000,
    pollIntervalMs = 10000
  ) {
    if (!authInfo || !groupId || !friendUid) return null;
    const getDocUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/groups/${groupId}`;
    const headers = { Authorization: `Bearer ${authInfo.id_token}` };
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const response = await axios.get(getDocUrl, { headers });
        const groupData = this.parseFirestoreDocument(response.data);
        const friendMembership = groupData?.membership?.[friendUid];
        if (friendMembership && friendMembership.accepted === true) {
          return { groupId: groupId, friendName: friendMembership.name || "" };
        }
      } catch (error) {
        console.error(
          "firebase i swear to fucking god:",
          error.response?.data || error.message
        );
      }
      await new Promise((res) => setTimeout(res, pollIntervalMs));
    }
    return null;
  }

  formatForFirestore(data, topLevel = false) {
    if (typeof data === "string") return { stringValue: data };
    if (typeof data === "boolean") return { booleanValue: data };
    if (typeof data === "number") {
      return Number.isInteger(data)
        ? { integerValue: data.toString() }
        : { doubleValue: data };
    }
    if (data instanceof Date) return { timestampValue: data.toISOString() };
    if (Array.isArray(data)) {
      return {
        arrayValue: {
          values: data.map((item) => this.formatForFirestore(item)),
        },
      };
    }
    if (typeof data === "object" && data !== null) {
      const fields = {};
      for (const [key, value] of Object.entries(data)) {
        fields[key] = this.formatForFirestore(value);
      }
      return topLevel ? fields : { mapValue: { fields } };
    }
    return {};
  }

  parseFirestoreDocument(docData) {
    if (!docData.fields) return {};
    const result = {};
    for (const [key, valueObj] of Object.entries(docData.fields)) {
      result[key] = this.parseFirestoreValue(valueObj);
    }
    return result;
  }

  parseFirestoreValue(valueDict) {
    if (!valueDict) return null;
    const valueType = Object.keys(valueDict)[0];
    const value = valueDict[valueType];
    switch (valueType) {
      case "stringValue":
      case "timestampValue":
      case "booleanValue":
        return value;
      case "integerValue":
        return parseInt(value);
      case "doubleValue":
        return parseFloat(value);
      case "nullValue":
        return null;
      case "mapValue":
        return this.parseFirestoreDocument(value);
      case "arrayValue":
        return (value.values || []).map((item) =>
          this.parseFirestoreValue(item)
        );
      default:
        return valueDict;
    }
  }
}

module.exports = FirebaseClient;
