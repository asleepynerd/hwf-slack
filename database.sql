CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    slack_user_id VARCHAR(50) UNIQUE NOT NULL,
    slack_team_id VARCHAR(50) NOT NULL,
    hwf_friend_code VARCHAR(10),
    hwf_user_id VARCHAR(100),
    friend_status VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS friend_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    friend_hwf_user_id VARCHAR(100) NOT NULL,
    friend_name VARCHAR(255),
    group_id VARCHAR(100),
    connection_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feelings_posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    friend_hwf_user_id VARCHAR(100) NOT NULL,
    slack_channel_id VARCHAR(50) NOT NULL,
    slack_message_ts VARCHAR(50),
    feelings_data JSONB,
    hwf_checkin_id VARCHAR(100),
    posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_configurations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    slack_channel_id VARCHAR(50) NOT NULL,
    include_notes BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, slack_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_users_slack_user_id ON users(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_connections_user_id ON friend_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_feelings_posts_user_id ON feelings_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feelings_posts_posted_at ON feelings_posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_channel_configurations_user_id ON channel_configurations(user_id);
CREATE INDEX IF NOT EXISTS idx_feelings_posts_checkin_id ON feelings_posts(user_id, friend_hwf_user_id, hwf_checkin_id);

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

DROP TRIGGER IF EXISTS update_friend_connections_updated_at ON friend_connections;
CREATE TRIGGER update_friend_connections_updated_at BEFORE UPDATE ON friend_connections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channel_configurations_updated_at BEFORE UPDATE ON channel_configurations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 