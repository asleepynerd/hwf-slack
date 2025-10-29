CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    slack_user_id VARCHAR(50) UNIQUE NOT NULL,
    slack_team_id VARCHAR(50) NOT NULL,
    api_key TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_configurations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    slack_channel_id VARCHAR(50) NOT NULL,
    include_notes BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    last_checkin_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slack_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_users_slack_user_id ON users(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key) WHERE api_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_configurations_user_id ON channel_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_configurations_active ON channel_configurations(is_active) WHERE is_active = true;
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_channel_configurations_updated_at ON channel_configurations;
CREATE TRIGGER update_channel_configurations_updated_at BEFORE UPDATE ON channel_configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
