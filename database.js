const { Pool } = require("pg");

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    });
  }

  async query(text, params) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  async createUser(slackUserId, slackTeamId) {
    const query = `INSERT INTO users (slack_user_id, slack_team_id) VALUES ($1, $2) ON CONFLICT (slack_user_id) DO NOTHING RETURNING *`;
    const result = await this.query(query, [slackUserId, slackTeamId]);
    return result.rows[0];
  }

  async getUser(slackUserId) {
    const query = `
      SELECT 
        u.*,
        COALESCE(
          (
            SELECT json_agg(c.*) 
            FROM channel_configurations c 
            WHERE c.user_id = u.id
          ), 
          '[]'
        ) AS channel_configurations
      FROM users u
      WHERE u.slack_user_id = $1
    `;
    const result = await this.query(query, [slackUserId]);
    return result.rows[0];
  }

  async updateUserFriendCode(slackUserId, friendCode, hwfUserId = null) {
    const query = `UPDATE users SET hwf_friend_code = $2, hwf_user_id = $3, updated_at = CURRENT_TIMESTAMP, friend_status = 'pending' WHERE slack_user_id = $1 RETURNING *`;
    const result = await this.query(query, [
      slackUserId,
      friendCode,
      hwfUserId,
    ]);
    return result.rows[0];
  }

  async setUserFriendStatus(slackUserId, status) {
    const query = `UPDATE users SET friend_status = $2, updated_at = CURRENT_TIMESTAMP WHERE slack_user_id = $1 RETURNING *`;
    const result = await this.query(query, [slackUserId, status]);
    return result.rows[0];
  }

  async addChannelConfiguration(userId, channelId, includeNotes) {
    const query = `
      INSERT INTO channel_configurations (user_id, slack_channel_id, include_notes) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (user_id, slack_channel_id) 
      DO UPDATE SET include_notes = $3, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await this.query(query, [userId, channelId, includeNotes]);
    return result.rows[0];
  }

  async updateChannelConfiguration(configId, includeNotes, isActive) {
    const query = `
      UPDATE channel_configurations 
      SET include_notes = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1 RETURNING *`;
    const result = await this.query(query, [configId, includeNotes, isActive]);
    return result.rows[0];
  }

  async removeChannelConfiguration(configId) {
    const query = "DELETE FROM channel_configurations WHERE id = $1";
    await this.query(query, [configId]);
  }

  async getChannelConfigurationById(configId) {
    const query = "SELECT * FROM channel_configurations WHERE id = $1";
    const result = await this.query(query, [configId]);
    return result.rows[0];
  }

  async setUserActive(slackUserId, isActive) {
    const user = await this.getUser(slackUserId);
    if (!user) return;
    const query = `UPDATE channel_configurations SET is_active = $2 WHERE user_id = $1`;
    await this.query(query, [user.id, isActive]);
  }

  async createFriendConnection(userId, friendHwfUserId, friendName, groupId) {
    const query = `INSERT INTO friend_connections (user_id, friend_hwf_user_id, friend_name, group_id) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, friend_hwf_user_id) DO UPDATE SET friend_name = $3, group_id = $4, updated_at = CURRENT_TIMESTAMP RETURNING *`;
    const result = await this.query(query, [
      userId,
      friendHwfUserId,
      friendName,
      groupId,
    ]);
    return result.rows[0];
  }

  async createFeelingsPost(
    userId,
    friendHwfUserId,
    channelId,
    messageTs,
    feelingsData,
    hwfCheckinId
  ) {
    const query = `INSERT INTO feelings_posts (user_id, friend_hwf_user_id, slack_channel_id, slack_message_ts, feelings_data, hwf_checkin_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
    const result = await this.query(query, [
      userId,
      friendHwfUserId,
      channelId,
      messageTs,
      JSON.stringify(feelingsData),
      hwfCheckinId,
    ]);
    return result.rows[0];
  }

  async hasCheckinBeenPosted(userId, friendHwfUserId, channelId, hwfCheckinId) {
    const query = `SELECT id FROM feelings_posts WHERE user_id = $1 AND friend_hwf_user_id = $2 AND slack_channel_id = $3 AND hwf_checkin_id = $4`;
    const result = await this.query(query, [
      userId,
      friendHwfUserId,
      channelId,
      hwfCheckinId,
    ]);
    return result.rows.length > 0;
  }

  async getLastPostedCheckinId(userId, friendHwfUserId) {
    const query = `SELECT hwf_checkin_id FROM feelings_posts WHERE user_id = $1 AND friend_hwf_user_id = $2 ORDER BY posted_at DESC LIMIT 1`;
    const result = await this.query(query, [userId, friendHwfUserId]);
    return result.rows[0]?.hwf_checkin_id || null;
  }

  async getActiveUsersWithConfigurations() {
    const query = `
      SELECT 
        u.id as user_id, 
        u.slack_user_id,
        u.hwf_user_id,
        cc.id as channel_configuration_id,
        cc.slack_channel_id,
        cc.include_notes
      FROM users u
      JOIN channel_configurations cc ON u.id = cc.user_id
      WHERE cc.is_active = true;
    `;
    const result = await this.query(query);
    return result.rows;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
