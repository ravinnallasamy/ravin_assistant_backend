const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for admin tasks

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL or Key missing!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
