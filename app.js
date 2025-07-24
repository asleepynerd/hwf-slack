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

    if (user.channel_configurations && user.channel_configurations.length > 0) {
      blocks.push({ type: "divider" });
      user.channel_configurations.forEach((config) => {
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*<#${config.slack_channel_id}>* | ${
                config.is_active ? "Active" : "Paused"
              } | ${
                config.include_notes ? "Feelings + Notes" : "Feelings only"
              }`,
            },
            accessory: {
              type: "overflow",
              options: [
                {
                  text: {
                    type: "plain_text",
                    text: config.is_active ? "Pause" : "Resume",
                  },
                  value: `toggle_channel_active:${config.id}`,
                },
                {
                  text: { type: "plain_text", text: "Edit" },
                  value: `edit_channel:${config.id}`,
                },
                {
                  text: { type: "plain_text", text: "Delete" },
                  value: `delete_channel:${config.id}`,
                },
              ],
              action_id: "channel_actions",
            },
          },
          { type: "divider" }
        );
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "you haven't added any channels yet. add one to get started!",
        },
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Add Channel",
          },
          action_id: "add_channel",
          style: "primary",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Test All Channels",
          },
          action_id: "test_all_channels",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Pause/Resume All",
          },
          action_id: "toggle_all_channels",
        },
      ],
    });
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

app.action("channel_actions", async ({ ack, body, client, payload }) => {
  await ack();
  const [action, value] = payload.selected_option.value.split(":");
  const configId = parseInt(value, 10);
  const userId = body.user.id;

  if (action === "toggle_channel_active") {
    const config = await db.getChannelConfigurationById(configId);
    if (config) {
      await db.updateChannelConfiguration(
        configId,
        config.include_notes,
        !config.is_active
      );
    }
  } else if (action === "edit_channel") {
    // wrrf wrrf
    const config = await db.getChannelConfigurationById(configId);
    const modal = buildChannelSelectModal(config);
    await client.views.open({
      trigger_id: body.trigger_id,
      view: modal,
    });
    return; // sorry my dog got on my keyboard
  } else if (action === "delete_channel") {
    await db.removeChannelConfiguration(configId);
  }

  const updatedUser = await db.getUser(userId);
  const homeView = buildHomeView(updatedUser);
  await client.views.publish({ user_id: userId, view: homeView });
});

app.action("add_channel", async ({ ack, body, client }) => {
  await ack();
  const modal = buildChannelSelectModal();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: modal,
  });
});

app.action("toggle_all_channels", async ({ ack, body, client }) => {
  await ack();
  const user = await db.getUser(body.user.id);
  const allActive = user.channel_configurations.every((c) => c.is_active);
  for (const config of user.channel_configurations) {
    await db.updateChannelConfiguration(
      config.id,
      config.include_notes,
      !allActive
    );
  }
  const updatedUser = await db.getUser(body.user.id);
  const homeView = buildHomeView(updatedUser);
  await client.views.publish({ user_id: body.user.id, view: homeView });
});

function buildChannelSelectModal(config = null) {
  const initialChannel = config?.slack_channel_id || "";
  const initialNotesValue = config?.include_notes ? "true" : "false";

  return {
    type: "modal",
    callback_id: "channel_select_modal",
    private_metadata: config ? JSON.stringify({ config_id: config.id }) : "{}",
    title: {
      type: "plain_text",
      text: config ? "Edit Channel" : "Add Channel",
    },
    submit: {
      type: "plain_text",
      text: "Save",
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
          text: "select a channel and what you'd like to post.",
        },
      },
      {
        type: "input",
        block_id: "channel_input",
        element: {
          type: "conversations_select",
          action_id: "channel_id",
          placeholder: {
            type: "plain_text",
            text: "select a channel...",
          },
          initial_conversation: initialChannel || undefined,
        },
        label: {
          type: "plain_text",
          text: "Channel",
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
              text:
                initialNotesValue === "true"
                  ? "Feelings + Notes"
                  : "Feelings only",
            },
            value: initialNotesValue,
          },
        },
        label: {
          type: "plain_text",
          text: "What to Post",
        },
      },
    ],
  };
}

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

app.action("test_all_channels", async ({ ack, body, client }) => {
  await ack();
  const user = await db.getUser(body.user.id);
  if (
    !user.channel_configurations ||
    user.channel_configurations.length === 0
  ) {
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "no channels configured to test",
    });
    return;
  }
  await client.chat.postEphemeral({
    channel: body.user.id,
    user: body.user.id,
    text: "testing all active channels...",
  });
  await checkAndPostFeelingsForUser(user, client, true);
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
  const channelId =
    view.state.values.channel_input.channel_id.selected_conversation;
  const includeNotes =
    view.state.values.notes_input.include_notes.selected_option.value ===
    "true";
  const userId = body.user.id;
  const user = await db.getUser(userId);

  const metadata = JSON.parse(view.private_metadata || "{}");
  const configId = metadata.config_id;

  if (!channelId) {
    await ack({
      response_action: "errors",
      errors: {
        channel_input: "please select a channel",
      },
    });
    return;
  }

  try {
    const botInfo = await client.auth.test();
    const botUserId = botInfo.user_id;
    const members = await client.conversations.members({ channel: channelId });

    if (!members.members.includes(botUserId)) {
      await ack({
        response_action: "errors",
        errors: {
          channel_input: "i'm not in that channel. please add me first!",
        },
      });
      return;
    }

    await ack();

    if (configId) {
      await db.updateChannelConfiguration(configId, includeNotes, true);
    } else {
      await db.addChannelConfiguration(user.id, channelId, includeNotes);
    }

    const updatedUser = await db.getUser(userId);
    const homeView = buildHomeView(updatedUser);
    await client.views.publish({ user_id: userId, view: homeView });
  } catch (error) {
    console.error("error saving channel config:", error);
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: "there was an error saving the channel configuration.",
    });
  }
});

async function checkAndPostFeelingsForUser(user, client, isTest = false) {
  if (!user.hwf_user_id) {
    console.log(`skipping user ${user.slack_user_id}: no hwf_user_id`);
    return;
  }

  const activeConfigs = user.channel_configurations.filter(
    (c) => c.is_active || isTest
  );
  if (activeConfigs.length === 0) {
    return;
  }

  try {
    const allFriendsFeelings = await firebase.getFriendsData();
    const friendFeeling = allFriendsFeelings.find(
      (f) => f.friendId === user.hwf_user_id
    );

    if (
      !friendFeeling ||
      !friendFeeling.accepted ||
      !friendFeeling.hasCheckin
    ) {
      if (isTest) {
        for (const config of activeConfigs) {
          await client.chat.postEphemeral({
            channel: config.slack_channel_id,
            user: user.slack_user_id,
            text: `(test) no new feelings found for *${
              friendFeeling?.friendName || "your friend"
            }*`,
          });
        }
      }
      return;
    }

    for (const config of activeConfigs) {
      if (!isTest) {
        const lastPostedCheckinId = await db.getLastPostedCheckinId(
          user.id,
          friendFeeling.friendId
        );
        if (lastPostedCheckinId === friendFeeling.checkinId) {
          continue;
        }
      }

      const message = buildFeelingsMessage(friendFeeling, config.include_notes);
      const result = await client.chat.postMessage({
        channel: config.slack_channel_id,
        ...message,
      });

      await db.createFeelingsPost(
        user.id,
        friendFeeling.friendId,
        config.slack_channel_id,
        result.ts,
        friendFeeling,
        friendFeeling.checkinId
      );

      console.log(
        `posted ${friendFeeling.friendName} to ${config.slack_channel_id}`
      );
    }
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
    const noteLines = friend.note
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
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
      }
    }

    const activeConfigs = await db.getActiveUsersWithConfigurations();

    for (const config of activeConfigs) {
      const friendFeeling = feelingsMap.get(config.hwf_user_id);

      if (
        friendFeeling &&
        friendFeeling.accepted &&
        friendFeeling.hasCheckin &&
        friendFeeling.checkinId
      ) {
        // you stupid fucking idiot i keep fucking this up
        const alreadyPosted = await db.hasCheckinBeenPosted(
          config.user_id,
          friendFeeling.friendId,
          config.slack_channel_id,
          friendFeeling.checkinId
        );

        if (alreadyPosted) {
          continue;
        }

        try {
          const message = buildFeelingsMessage(
            friendFeeling,
            config.include_notes
          );
          const result = await app.client.chat.postMessage({
            channel: config.slack_channel_id,
            ...message,
          });
          await db.createFeelingsPost(
            config.user_id,
            friendFeeling.friendId,
            config.slack_channel_id,
            result.ts,
            friendFeeling,
            friendFeeling.checkinId
          );

          console.log(
            `posted ${friendFeeling.friendName} to ${config.slack_channel_id}`
          );
        } catch (e) {
          if (e.data?.error === "channel_not_found") {
            console.error(
              `channel ${config.slack_channel_id} not found for user ${config.user_id}, removing config`
            );
            await db.removeChannelConfiguration(
              config.channel_configuration_id
            );
          } else {
            console.error(
              `failed to post for user ${config.user_id} in channel ${config.slack_channel_id}:`,
              e
            );
          }
        }
      }
    }

    console.log(`checked feelings for ${activeConfigs.length} configurations`);
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
