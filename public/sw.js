/* Push content and navigation are deliberately fixed: no private context is shown. */
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Veya', {
    body: 'You have a new update in Veya', data: {url: '/notifications'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/notifications'));
});
