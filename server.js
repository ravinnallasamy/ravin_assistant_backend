require('dotenv').config();
const app = require('./app');
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 5000;
app.use("/tmp", express.static(path.join(__dirname, "tmp")));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
