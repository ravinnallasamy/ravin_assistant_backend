// Usage: node scripts/hash-password.js <plaintext-password>
// Prints a bcrypt hash to store in the admin.password_hash column.
const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node scripts/hash-password.js <plaintext-password>');
    process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
    console.log(hash);
});
