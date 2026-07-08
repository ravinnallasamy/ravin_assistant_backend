const supabase = require('./services/supabaseClient');

async function testConnection() {
    console.log('Testing connection to Supabase...');
    console.log('Supabase URL:', process.env.SUPABASE_URL ? 'Loaded' : 'MISSING');
    console.log('Supabase Service Role Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Loaded' : 'MISSING');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Error: Missing credentials in your .env file.');
        process.exit(1);
    }

    try {
        // Try fetching a single row from the profile table
        const { data, error } = await supabase
            .from('profile')
            .select('*')
            .limit(1);

        if (error) {
            console.error('Connection failed! Supabase API returned an error:');
            console.error(error);
            process.exit(1);
        }

        console.log('Connection successful!');
        console.log('Retrieved data preview:', data);
        process.exit(0);
    } catch (err) {
        console.error('An unexpected error occurred while connecting:');
        console.error(err);
        process.exit(1);
    }
}

testConnection();
