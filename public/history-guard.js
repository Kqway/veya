// Loaded before hydration: popstate targets window, so listener registration order
// matters even for capture listeners. Give an unsaved editor a chance before Next
// restores the previous route. No draft, identity or credentials enter this event.
if (!window.__intavroHistoryGuardInstalled) {
  window.__intavroHistoryGuardInstalled = true;
  window.addEventListener("popstate", (event) => {
    const before = new Event("intavro:before-history-navigation", { cancelable: true });
    if (!window.dispatchEvent(before)) event.stopImmediatePropagation();
  });
}
