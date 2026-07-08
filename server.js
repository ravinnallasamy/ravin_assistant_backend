require('dotenv').config();
const { assertRequiredEnv } = require('./services/envCheck');

assertRequiredEnv();

const app = require('./app');
const { startTmpCleanup } = require('./services/tmpCleanup');

const PORT = process.env.PORT || 5000;

startTmpCleanup();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
