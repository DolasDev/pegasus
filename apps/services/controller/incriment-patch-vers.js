const fs = require('fs');
const path = require('path');

// Path to the package.json file
const packageJsonPath = path.join(__dirname, 'package.json');

try {
  // Read the package.json file
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  if (!packageJson.version) {
    throw new Error("The 'version' property is missing in package.json.");
  }

  // Split the version into major, minor, and patch
  const [major, minor, patch] = packageJson.version.split('.').map(Number);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error("The 'version' property is not in a valid format (expected: x.y.z).");
  }

  // Increment the minor version
  const newVersion = `${major}.${minor}.${patch + 1}`;

  // Update the version in the package.json object
  packageJson.version = newVersion;

  // Write the updated package.json back to the file
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');

  console.log(`Version updated successfully to ${newVersion}`);
} catch (error) {
  console.error(`Failed to update version: ${error.message}`);
}
