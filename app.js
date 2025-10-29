require("dotenv").config();
const { App } = require("@slack/bolt");
const cron = require("node-cron");
const WebSocket = require("ws");
const axios = require("axios");

const Database = require("./database");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: process.env.SOCKET_MODE === "true",
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});

const db = new Database();
const API_BASE_URL = process.env.HWF_API_URL || "https://hwf.erm.wtf";

const wsConnections = new Map();

function isValidAPIKey(key) {
  return /^hwf_[a-zA-Z0-9]{40,}$/.test(key);
}

async function makeAPIRequest(apiKey, endpoint) {
  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.data;
  } catch (error) {
    console.error(`API request failed: ${error.message}`);
    return null;
  }
}

function setupWebSocket(user, client) {
  if (!user.api_key) return;

  if (wsConnections.has(user.id)) {
    wsConnections.get(user.id).close();
  }

  const wsUrl = `${API_BASE_URL.replace(/^http/, "ws")}/api/v1/ws?token=${user.api_key}`;
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`WebSocket connected for user ${user.slack_user_id}`);
  });

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === "feeling") {
        await handleNewFeeling(user, message.data, client);
      }
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  ws.on("error", (error) => {
    console.error(
      `WebSocket error for user ${user.slack_user_id}:`,
      error.message,
    );
  });

  ws.on("close", () => {
    console.log(`WebSocket closed for user ${user.slack_user_id}`);
    wsConnections.delete(user.id);
  });

  wsConnections.set(user.id, ws);
}

async function handleNewFeeling(user, feeling, client) {
  const activeConfigs = user.channel_configurations.filter((c) => c.is_active);
  if (activeConfigs.length === 0) return;

  for (const config of activeConfigs) {
    const lastCheckinId = await db.getLastCheckinId(config.id);
    if (lastCheckinId === feeling.checkin_id) continue;

    const message = buildFeelingsMessage(feeling, config.include_notes);
    try {
      await client.chat.postMessage({
        channel: config.slack_channel_id,
        ...message,
      });
      await db.updateLastCheckinId(config.id, feeling.checkin_id);
      console.log(
        `Posted ${feeling.friend_name} to ${config.slack_channel_id}`,
      );
    } catch (error) {
      console.error(
        `Error posting to channel ${config.slack_channel_id}:`,
        error,
      );
    }
  }
}

app.event("app_home_opened", async ({ event, client }) => {
  try {
    await db.createUser(event.user, event.view?.team_id || "unknown");
    const user = await db.getUser(event.user);
    const homeView = buildHomeView(user);
    await client.views.publish({ user_id: event.user, view: homeView });
  } catch (error) {
    console.error("Error handling app_home_opened:", error);
  }
});

function buildHomeView(user) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "how we feel" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "posts your feelings from how we feel to slack channels",
      },
    },
    { type: "divider" },
  ];

  if (!user?.api_key) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "get an api key from https://hwf.erm.wtf (sign in with github, connect hwf account, generate key), then add it here",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "add api key" },
            action_id: "add_api_key",
            style: "primary",
          },
        ],
      },
    );
  } else {
    const maskedKey = `${user.api_key.substring(0, 10)}...${user.api_key.substring(user.api_key.length - 4)}`;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `connected\napi key: \`${maskedKey}\`` },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "update key" },
        action_id: "add_api_key",
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
              text: `*<#${config.slack_channel_id}>*\n${config.is_active ? "✓ active" : "⏸ paused"} • ${config.include_notes ? "notes included" : "feelings only"}`,
            },
            accessory: {
              type: "overflow",
              options: [
                {
                  text: {
                    type: "plain_text",
                    text: config.is_active ? "pause" : "resume",
                  },
                  value: `toggle:${config.id}`,
                },
                {
                  text: { type: "plain_text", text: "edit" },
                  value: `edit:${config.id}`,
                },
                {
                  text: { type: "plain_text", text: "delete" },
                  value: `delete:${config.id}`,
                },
              ],
              action_id: "channel_actions",
            },
          },
          { type: "divider" },
        );
      });
    } else {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "no channels yet. add one to get started!",
        },
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "add channel" },
          action_id: "add_channel",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "test all" },
          action_id: "test_all_channels",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "toggle all" },
          action_id: "toggle_all_channels",
        },
      ],
    });
  }

  return { type: "home", blocks: blocks };
}

app.action("add_api_key", async ({ ack, body, client }) => {
  await ack();
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "api_key_modal",
      title: { type: "plain_text", text: "add api key" },
      submit: { type: "plain_text", text: "connect" },
      close: { type: "plain_text", text: "cancel" },
      blocks: [
        {
          type: "input",
          block_id: "api_key_input",
          element: {
            type: "plain_text_input",
            action_id: "api_key",
            placeholder: { type: "plain_text", text: "hwf_..." },
          },
          label: { type: "plain_text", text: "api key" },
        },
      ],
    },
  });
});

app.view("api_key_modal", async ({ ack, body, view, client }) => {
  await ack();

  try {
    const apiKey = view.state.values.api_key_input.api_key.value.trim();
    const slackUserId = body.user.id;

    if (!isValidAPIKey(apiKey)) {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: "invalid api key format",
      });
      return;
    }

    const testResponse = await makeAPIRequest(apiKey, "/api/v1/feelings");
    if (!testResponse) {
      await client.chat.postEphemeral({
        channel: slackUserId,
        user: slackUserId,
        text: "failed to connect. check that the key is valid",
      });
      return;
    }

    await db.updateUserAPIKey(slackUserId, apiKey);
    const updatedUser = await db.getUser(slackUserId);
    setupWebSocket(updatedUser, client);

    const homeView = buildHomeView(updatedUser);
    await client.views.publish({ user_id: slackUserId, view: homeView });

    await client.chat.postEphemeral({
      channel: slackUserId,
      user: slackUserId,
      text: "connected!",
    });
  } catch (error) {
    console.error("Error processing API key modal:", error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "error. try again",
    });
  }
});

app.action("channel_actions", async ({ ack, body, client, payload }) => {
  await ack();
  const [action, value] = payload.selected_option.value.split(":");
  const configId = parseInt(value, 10);
  const userId = body.user.id;

  if (action === "toggle") {
    const config = await db.getChannelConfigurationById(configId);
    if (config) {
      await db.updateChannelConfiguration(
        configId,
        config.include_notes,
        !config.is_active,
      );
    }
  } else if (action === "edit") {
    const config = await db.getChannelConfigurationById(configId);
    const modal = buildChannelSelectModal(config);
    await client.views.open({ trigger_id: body.trigger_id, view: modal });
    return;
  } else if (action === "delete") {
    await db.removeChannelConfiguration(configId);
  }

  const updatedUser = await db.getUser(userId);
  const homeView = buildHomeView(updatedUser);
  await client.views.publish({ user_id: userId, view: homeView });
});

app.action("add_channel", async ({ ack, body, client }) => {
  await ack();
  const modal = buildChannelSelectModal();
  await client.views.open({ trigger_id: body.trigger_id, view: modal });
});

app.action("toggle_all_channels", async ({ ack, body, client }) => {
  await ack();
  const user = await db.getUser(body.user.id);
  const allActive = user.channel_configurations.every((c) => c.is_active);
  for (const config of user.channel_configurations) {
    await db.updateChannelConfiguration(
      config.id,
      config.include_notes,
      !allActive,
    );
  }
  const updatedUser = await db.getUser(body.user.id);
  const homeView = buildHomeView(updatedUser);
  await client.views.publish({ user_id: body.user.id, view: homeView });
});

app.action("test_all_channels", async ({ ack, body, client }) => {
  await ack();
  const user = await db.getUser(body.user.id);

  if (!user.api_key) {
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "add an api key first",
    });
    return;
  }

  if (
    !user.channel_configurations ||
    user.channel_configurations.length === 0
  ) {
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: "no channels configured",
    });
    return;
  }

  await testAllChannelsForUser(user, client);
});

async function testAllChannelsForUser(user, client) {
  const activeConfigs = user.channel_configurations.filter((c) => c.is_active);
  if (activeConfigs.length === 0) return;

  try {
    const data = await makeAPIRequest(user.api_key, "/api/v1/feelings");
    if (!data || !data.feelings || data.feelings.length === 0) {
      await client.chat.postEphemeral({
        channel: user.slack_user_id,
        user: user.slack_user_id,
        text: "no feelings found",
      });
      return;
    }

    const feeling = data.feelings[0];

    for (const config of activeConfigs) {
      const message = buildFeelingsMessage(feeling, config.include_notes);
      await client.chat.postMessage({
        channel: config.slack_channel_id,
        text: `(test) ${message.text}`,
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "🧪 _test message_" }],
          },
          ...message.blocks,
        ],
      });
    }

    await client.chat.postEphemeral({
      channel: user.slack_user_id,
      user: user.slack_user_id,
      text: "test sent",
    });
  } catch (error) {
    console.error(`Error testing channels for user ${user.id}:`, error);
  }
}

function buildChannelSelectModal(config = null) {
  const initialChannel = config?.slack_channel_id || "";
  const initialNotesValue = config?.include_notes ? "true" : "false";

  return {
    type: "modal",
    callback_id: "channel_select_modal",
    private_metadata: JSON.stringify({ config_id: config?.id || null }),
    title: {
      type: "plain_text",
      text: config ? "edit channel" : "add channel",
    },
    submit: { type: "plain_text", text: config ? "update" : "add" },
    close: { type: "plain_text", text: "cancel" },
    blocks: [
      {
        type: "input",
        block_id: "channel_input",
        element: {
          type: "conversations_select",
          action_id: "channel_id",
          initial_conversation: initialChannel || undefined,
          filter: { include: ["public", "private"] },
        },
        label: { type: "plain_text", text: "channel" },
      },
      {
        type: "input",
        block_id: "notes_input",
        element: {
          type: "radio_buttons",
          action_id: "include_notes",
          initial_option: {
            text: {
              type: "plain_text",
              text: initialNotesValue === "true" ? "yes" : "no",
            },
            value: initialNotesValue,
          },
          options: [
            {
              text: { type: "plain_text", text: "feelings only" },
              value: "false",
            },
            {
              text: { type: "plain_text", text: "feelings + notes" },
              value: "true",
            },
          ],
        },
        label: { type: "plain_text", text: "include notes?" },
      },
    ],
  };
}

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
      errors: { channel_input: "select a channel" },
    });
    return;
  }

  await ack();

  try {
    if (configId) {
      await db.updateChannelConfiguration(configId, includeNotes, true);
    } else {
      await db.addChannelConfiguration(user.id, channelId, includeNotes);
    }

    const updatedUser = await db.getUser(userId);
    const homeView = buildHomeView(updatedUser);
    await client.views.publish({ user_id: userId, view: homeView });

    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `✓ channel ${configId ? "updated" : "added"}`,
    });
  } catch (error) {
    console.error("Error saving channel configuration:", error);
  }
});

function getMoodIcon(moodName) {
  const fileName = `mood_${moodName.toLowerCase().replace(/\s+/g, "_")}.png`;
  return `https://furry.lat/hwf_moods/${fileName}`;
}

function buildFeelingsMessage(feeling, includeNotes) {
  const moodText = feeling.moods.join(", ");
  let text = `*${feeling.friend_name}* is feeling: ${moodText}`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${feeling.friend_name}* is feeling: ${moodText}`,
      },
    },
  ];

  if (feeling.moods.length > 0) {
    const firstMoodIcon = getMoodIcon(feeling.moods[0]);
    if (firstMoodIcon) {
      blocks[0].accessory = {
        type: "image",
        image_url: firstMoodIcon,
        alt_text: feeling.moods[0],
      };
    }
  }

  if (includeNotes && feeling.note) {
    const noteLines = feeling.note
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: noteLines },
    });
  }

  return { text: text, blocks: blocks };
}

cron.schedule("*/5 * * * *", async () => {
  console.log("checking websocket connections...");
  try {
    const allUsers = await db.getAllUsers();
    for (const user of allUsers) {
      if (!user.api_key) continue;
      if (wsConnections.has(user.id)) continue;
      setupWebSocket(user, app.client);
    }
  } catch (error) {
    console.error("Error in periodic check:", error);
  }
});

(async () => {
  try {
    await app.start(process.env.PORT || 3000);
    console.log("slack bot running");

    const allUsers = await db.getAllUsers();
    for (const user of allUsers) {
      if (user.api_key) {
        setupWebSocket(user, app.client);
      }
    }
    console.log(
      `initialized ${allUsers.filter((u) => u.api_key).length} websockets`,
    );
  } catch (error) {
    console.error("error starting app:", error);
    process.exit(1);
  }
})();

process.on("SIGTERM", () => {
  console.log("shutting down...");
  wsConnections.forEach((ws) => ws.close());
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("shutting down...");
  wsConnections.forEach((ws) => ws.close());
  process.exit(0);
});
