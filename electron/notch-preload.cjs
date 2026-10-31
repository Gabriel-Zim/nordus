const { contextBridge, ipcRenderer } = require("electron");

let paint = null;
ipcRenderer.on("notch:view", (_event, view) => {
  if (paint && view && typeof view === "object") paint(view);
});

// The notch page can draw a view and ask for two things; it never learns a token, a path or a conversation id.
contextBridge.exposeInMainWorld("notchWindow", {
  onView: (callback) => {
    paint = typeof callback === "function" ? callback : null;
    ipcRenderer.send("notch:ready");
  },
  decide: (id, decision) => ipcRenderer.send("notch:decide", { id, decision }),
  open: () => ipcRenderer.send("notch:open"),
});
