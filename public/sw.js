self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "due") return;
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, lang: "pt-BR" }));
});
