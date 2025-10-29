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
    const query = `
      INSERT INTO users (slack_user_id, slack_team_id)
      VALUES ($1, $2)
      ON CONFLICT (slack_user_id) DO NOTHING
      RETURNING *
    `;
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

  async getAllUsers() {
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
      WHERE u.api_key IS NOT NULL
    `;
    const result = await this.query(query);
    return result.rows;
  }

  async updateUserAPIKey(slackUserId, apiKey) {
    const query = `
      UPDATE users
      SET api_key = $2, updated_at = CURRENT_TIMESTAMP
      WHERE slack_user_id = $1
      RETURNING *
    `;
    const result = await this.query(query, [slackUserId, apiKey]);
    return result.rows[0];
  }

  async addChannelConfiguration(userId, channelId, includeNotes) {
    const query = `
      INSERT INTO channel_configurations (user_id, slack_channel_id, include_notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, slack_channel_id)
      DO UPDATE SET
        include_notes = $3,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await this.query(query, [userId, channelId, includeNotes]);
    return result.rows[0];
  }

  async updateChannelConfiguration(configId, includeNotes, isActive) {
    const query = `
      UPDATE channel_configurations
      SET
        include_notes = $2,
        is_active = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
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

  async getLastCheckinId(configId) {
    const query = `
      SELECT last_checkin_id
      FROM channel_configurations
      WHERE id = $1
    `;
    const result = await this.query(query, [configId]);
    return result.rows[0]?.last_checkin_id || null;
  }

  async updateLastCheckinId(configId, checkinId) {
    const query = `
      UPDATE channel_configurations
      SET last_checkin_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    await this.query(query, [configId, checkinId]);
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
