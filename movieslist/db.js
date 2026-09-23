const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "movies.json");

// Create an empty database if it does not exist
if (!fs.existsSync(FILE)) {
  fs.writeFileSync(FILE, "[]");
}

// Read all movies
exports.read = () => {
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
};

// Save all movies
exports.write = (movies) => {
  fs.writeFileSync(FILE, JSON.stringify(movies, null, 2));
};