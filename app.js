require("dotenv").config();
const { App } = require("@slack/bolt");
const cron = require("node-cron");

const Database = require("./database");
const FirebaseClient = require("./firebase");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

const db = new Database();
const firebase = new FirebaseClient();

app.event("app_home_opened", async ({ event, client }) => {
  try {
    await db.createUser(event.user, event.view?.team_id || "unknown");

    const user = await db.getUser(event.user);

    const homeView = buildHomeView(user);

    await client.views.publish({
      user_id: event.user,
      view: homeView,
    });
  } catch (error) {
    console.error("error handling app_home_opened:", error);
  }
});

function buildHomeView(user) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "how we feel",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "welcome! this bot helps you share your friends' feelings from the how we feel app directly in slack channels.",
      },
    },
    {
      type: "divider",
    },
  ];
  if (!user?.hwf_friend_code) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "enter your how we feel friend code to connect your account.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "add friend code",
            },
            action_id: "add_friend_code",
            style: "primary",
          },
        ],
      }
    );
  } else if (user.friend_status === "pending") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `pending: waiting for you to accept the request...\nfriend code \`${user.hwf_friend_code}\``,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `connected: friend code \`${user.hwf_friend_code}\``,
      },
    });

    if (!user.target_channel_id) {
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "choose where to post your friends' feelings.",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "select channel",
              },
              action_id: "select_channel",
              style: "primary",
            },
          ],
        }
      );
    } else {
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `posting to: <#${user.target_channel_id}> ${
              user.include_notes ? "(with notes)" : "(feelings only)"
            }`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: user.is_active
              ? "active - bot is monitoring and posting"
              : "inactive",
          },
        }
      );
    }

    blocks.push(
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "settings & actions:",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "change channel",
            },
            action_id: "select_channel",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: user.is_active ? "pause bot" : "start bot",
            },
            action_id: "toggle_active",
            style: user.is_active ? undefined : "primary",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "test now",
            },
            action_id: "test_feelings",
          },
        ],
      }
    );
  }

  return {
    type: "home",
    blocks: blocks,
  };
}

app.action("add_friend_code", async ({ ack, body, client }) => {
  await ack();

  const modal = {
    type: "modal",
    callback_id: "friend_code_modal",
    title: {
      type: "plain_text",
      text: "Add Friend Code",
    },
    submit: {
      type: "plain_text",
      text: "Connect",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Enter your How We Feel friend code to connect your account. You can find this in the How We Feel app settings.",
        },
      },
      {
        type: "input",
        block_id: "friend_code_input",
        element: {
          type: "plain_text_input",
          action_id: "friend_code",
          placeholder: {
            type: "plain_text",
            text: "e.g., ABC123",
          },
          max_length: 10,
        },
        label: {
          type: "plain_text",
          text: "Friend Code",
        },
      },
    ],
  };

  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal,
  });
});

app.action("select_channel", async ({ ack, body, client }) => {
  await ack();

  const modal = {
    type: "modal",
    callback_id: "channel_select_modal",
    title: {
      type: "plain_text",
      text: "Configure Posting",
    },
    submit: {
      type: "plain_text",
      text: "Save Settings",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Enter the Slack channel ID where you want to post your friends' feelings. You can find the channel ID by right-clicking on the channel and selecting \"Copy link\" - it's the last part after the last slash.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Example:* If the channel link is `https://yourworkspace.slack.com/archives/C01234ABCDE`, then the channel ID is `C01234ABCDE`",
        },
      },
      {
        type: "input",
        block_id: "channel_input",
        element: {
          type: "plain_text_input",
          action_id: "channel_id",
          placeholder: {
            type: "plain_text",
            text: "e.g., C01234ABCDE",
          },
          max_length: 15,
        },
        label: {
          type: "plain_text",
          text: "Channel ID",
        },
      },
      {
        type: "input",
        block_id: "notes_input",
        element: {
          type: "radio_buttons",
          action_id: "include_notes",
          options: [
            {
              text: {
                type: "plain_text",
                text: "Feelings only",
              },
              value: "false",
            },
            {
              text: {
                type: "plain_text",
                text: "Feelings + Notes",
              },
              value: "true",
            },
          ],
          initial_option: {
            text: {
              type: "plain_text",
              text: "Feelings only",
            },
            value: "false",
          },
        },
        label: {
          type: "plain_text",
          text: "What to Post",
        },
      },
    ],
  };

  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal,
  });
});

app.action("toggle_active", async ({ ack, body, client }) => {
  await ack();

  try {
    const user = await db.getUser(body.user.id);
    const newStatus = !user.is_active;

    await db.setUserActive(body.user.id, newStatus);

    const updatedUser = await db.getUser(body.user.id);
    const homeView = buildHomeView(updatedUser);

    await client.views.publish({
      user_id: body.user.id,
      view: homeView,
    });

    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `bot ${newStatus ? "activated" : "paused"}`,
    });
  } catch (error) {
    console.error("error toggling active status:", error);
  }
});

app.action("test_feelings", async ({ ack, body, client }) => {
  await ack();

  try {
    const user = await db.getUser(body.user.id);
    if (!user?.target_channel_id) {
      await client.chat.postEphemeral({
        channel: body.user.id,
        user: body.user.id,
        text: "please configure a channel first",
      });
      return;
    }

    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "testing... checking for feelings now",
    });

    await checkAndPostFeelings(user, client);
  } catch (error) {
    console.error("error testing feelings:", error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "test failed. check your config (or bully ella to fix it).",
    });
  }
});

app.view("friend_code_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const friendCode = view.state.values.friend_code_input.friend_code.value
      .trim()
      .toUpperCase();
    const slackUserId = body.user.id;

    if (!/^[A-Z0-9]{6}$/.test(friendCode)) {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: "invalid friend code format. it should be 6 characters (letters and numbers).",
      });
      return;
    }

    const friendInfo = await firebase.lookupUserByCode(friendCode);
    if (!friendInfo) {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: "friend code not found. check the code and try again.",
      });
      return;
    }

    const newGroupId = await firebase.sendFriendRequest(friendInfo);
    if (!newGroupId) {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: "failed to send friend request. try again later.",
      });
      return;
    }

    await db.updateUserFriendCode(slackUserId, friendCode, friendInfo.uid);

    await client.chat.postEphemeral({
      channel: slackUserId,
      user: slackUserId,
      text: `friend request sent to ${friendInfo.name}. waiting for them to accept... (this will timeout after 5 minutes)`,
    });

    const authInfo = await firebase.getFirebaseIdToken();

    const pollResult = await firebase.pollFriendAcceptance(
      authInfo,
      newGroupId,
      friendInfo.uid
    );

    if (pollResult) {
      const internalUser = await db.getUser(slackUserId);
      if (!internalUser) {
        console.error(
          "critical: could not find internal user for slack id:",
          slackUserId
        );
        await client.chat.postEphemeral({
          channel: slackUserId,
          user: slackUserId,
          text: "a critical internal error occurred. could not find your user record.",
        });
        return;
      }

      await db.createFriendConnection(
        internalUser.id,
        friendInfo.uid,
        pollResult.friendName,
        pollResult.groupId
      );

      await db.setUserFriendStatus(slackUserId, "connected");

      const updatedUser = await db.getUser(slackUserId);
      const homeView = buildHomeView(updatedUser);
      await client.views.publish({ user_id: slackUserId, view: homeView });

      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: `congrats, you've connected to ${friendInfo.name}`,
      });
    } else {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: `timed out waiting for *${friendInfo.name}* to accept. try again later.`,
      });
    }
  } catch (error) {
    console.error("error processing friend code modal:", error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "an unexpected error occurred while processing your request. try again.",
    });
  }
});

app.view("channel_select_modal", async ({ ack, body, view, client }) => {
  const channelId = view.state.values.channel_input.channel_id.value?.trim();
  const includeNotes =
    view.state.values.notes_input.include_notes.selected_option.value ===
    "true";
  const userId = body.user.id;

  if (!channelId || !/^C[A-Z0-9]{8,}$/.test(channelId)) {
    await ack({
      response_action: "errors",
      errors: {
        channel_input:
          "enter a valid slack channel id (starts with C followed by letters/numbers)",
      },
    });
    return;
  }

  try {
    const channelInfo = await client.conversations.info({
      channel: channelId,
    });

    if (!channelInfo.ok) {
      await ack({
        response_action: "errors",
        errors: {
          channel_input: "channel not found. check the id.",
        },
      });
      return;
    }

    const members = await client.conversations.members({
      channel: channelId,
    });

    const botInfo = await client.auth.test();
    const botUserId = botInfo.user_id;

    if (!members.members.includes(botUserId)) {
      await ack({
        response_action: "errors",
        errors: {
          channel_input: `i'm not a member of #${channelInfo.channel.name}. add me first.`,
        },
      });
      return;
    }

    await ack();

    await db.updateUserChannel(userId, channelId, includeNotes);

    const userInfo = await client.users.info({ user: userId });
    const userName =
      userInfo.user.real_name ||
      userInfo.user.display_name ||
      userInfo.user.name;

    await client.chat.postMessage({
      channel: channelId,
      text: `${userName} has set up how we feel notifications in this channel!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${userName} has set up how we feel notifications in this channel!`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `this channel will receive ${
                includeNotes ? "feelings and notes" : "feelings only"
              } from ${userName}, pssssst, did you know i'm <open source|https://github.com/asleepynerd/hwf-slack>?`,
            },
          ],
        },
      ],
    });

    const updatedUser = await db.getUser(userId);
    const homeView = buildHomeView(updatedUser);

    await client.views.publish({
      user_id: userId,
      view: homeView,
    });

    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `settings saved! feelings will be posted to #${
        channelInfo.channel.name
      } ${includeNotes ? "(with notes)" : "(feelings only)"}`,
    });
  } catch (error) {
    console.error("error saving channel settings:", error);

    if (error.data?.error === "channel_not_found") {
      await ack({
        response_action: "errors",
        errors: {
          channel_input: "channel not found. check the id.",
        },
      });
    } else if (error.data?.error === "not_in_channel") {
      await ack({
        response_action: "errors",
        errors: {
          channel_input: "i'm not a member of this channel. add me first.",
        },
      });
    } else {
      await ack();
      await client.chat.postEphemeral({
        channel: body.user.id,
        user: body.user.id,
        text: "failed to save settings. try again.",
      });
    }
  }
});

async function checkAndPostFeelings(user, client) {
  if (!user.is_active || !user.target_channel_id || !user.hwf_user_id) {
    console.log(`skipping user ${user.id} due to shit config`);
    return;
  }

  try {
    const allFriendsFeelings = await firebase.getFriendsData();
    const relevantFriendFeeling = allFriendsFeelings.find(
      (friend) => friend.friendId === user.hwf_user_id
    );
    if (!relevantFriendFeeling) {
      return;
    }

    const friend = relevantFriendFeeling;

    if (!friend.accepted || !friend.hasCheckin) return;

    const recentPost = await db.getRecentFeelingsPost(
      user.id,
      friend.friendId,
      6
    );
    if (recentPost) return;

    const message = buildFeelingsMessage(friend, user.include_notes);
    const result = await client.chat.postMessage({
      channel: user.target_channel_id,
      ...message,
    });

    await db.createFeelingsPost(
      user.id,
      friend.friendId,
      user.target_channel_id,
      result.ts,
      friend
    );

    console.log(`posted ${friend.friendName} to ${user.target_channel_id}`);
  } catch (error) {
    console.error(
      `error checking/posting feelings for user ${user.id}:`,
      error
    );
  }
}

function buildFeelingsMessage(friend, includeNotes) {
  const moodText = friend.moods
    .map((mood) => {
      return `${mood}`;
    })
    .join(", ");

  let text = `*${friend.friendName}* is feeling: ${moodText}`;

  if (includeNotes && friend.note) {
    const noteLines = friend.note.split('\n').map(line => `> ${line}`).join('\n');
    text += `\n${noteLines}`;
  }

  return {
    text: text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text,
        },
      },
    ],
  };
}

cron.schedule("* * * * *", async () => {
  console.log("getting data from firebase");

  try {
    const allFriendsFeelings = await firebase.getFriendsData();
    if (!allFriendsFeelings || allFriendsFeelings.length === 0) {
      console.log("nothing from firebase");
      return;
    }

    const feelingsMap = new Map();
    for (const feeling of allFriendsFeelings) {
      if (feeling.hasCheckin) {
        feelingsMap.set(feeling.friendId, feeling);
      } else {
        if (!feelingsMap.has(feeling.friendId)) {
          feelingsMap.set(feeling.friendId, feeling);
        }
      }
    }

    const activeUsers = await db.getActiveUsersWithChannels();

    for (const user of activeUsers) {
      if (!user.is_active || !user.target_channel_id || !user.hwf_user_id)
        continue;

      const friendFeeling = feelingsMap.get(user.hwf_user_id);

      if (
        friendFeeling &&
        (friendFeeling.accepted === true ||
          friendFeeling.accepted === undefined) &&
        friendFeeling.hasCheckin &&
        friendFeeling.checkinId
      ) {
        const lastPostedCheckinId = await db.getLastPostedCheckinId(
          user.id,
          friendFeeling.friendId
        );

        if (lastPostedCheckinId === friendFeeling.checkinId) {
          continue;
        }

        const message = buildFeelingsMessage(friendFeeling, user.include_notes);
        const result = await app.client.chat.postMessage({
          channel: user.target_channel_id,
          ...message,
        });

        await db.createFeelingsPost(
          user.id,
          friendFeeling.friendId,
          user.target_channel_id,
          result.ts,
          friendFeeling,
          friendFeeling.checkinId
        );

        console.log(
          `posted ${friendFeeling.friendName} to ${user.target_channel_id}`
        );
      }
    }

    console.log(`checked feelings for ${activeUsers.length} users`);
  } catch (error) {
    console.error("error in feelings check:", error);
  }
});

(async () => {
  try {
    await app.start();
    console.log("running");
  } catch (error) {
    console.error("error starting app:", error);
    process.exit(1);
  }
})();

process.on("SIGINT", async () => {
  console.log("shutting down");
  await db.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("shutting down");
  await db.close();
  process.exit(0);
});
