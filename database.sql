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
    posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_slack_user_id ON users(slack_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_connections_user_id ON friend_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_feelings_posts_user_id ON feelings_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feelings_posts_posted_at ON feelings_posts(posted_at);

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
-- sql i fucking hate you

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

CREATE INDEX IF NOT EXISTS idx_channel_configurations_user_id ON channel_configurations(user_id);

CREATE TRIGGER update_channel_configurations_updated_at BEFORE UPDATE ON channel_configurations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
DECLARE
    u RECORD;
BEGIN
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='target_channel_id') THEN
        FOR u IN SELECT id, target_channel_id, include_notes, is_active FROM users WHERE target_channel_id IS NOT NULL LOOP
            INSERT INTO channel_configurations (user_id, slack_channel_id, include_notes, is_active)
            VALUES (u.id, u.target_channel_id, u.include_notes, u.is_active)
            ON CONFLICT (user_id, slack_channel_id) DO NOTHING;
        END LOOP;
    END IF;
END;
$$;

ALTER TABLE users DROP COLUMN IF EXISTS target_channel_id;
ALTER TABLE users DROP COLUMN IF EXISTS include_notes;
ALTER TABLE users DROP COLUMN IF EXISTS is_active; 