const generateDefaultAvatar = (displayName) => {
  if (!displayName) {
    displayName = "User";
  }
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`;
};

module.exports = {
  generateDefaultAvatar,
};
