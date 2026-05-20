const params = new URLSearchParams(window.location.search);

export const hiddenModes = Object.freeze({
  rabbit: params.get("for") === "elle",
});
