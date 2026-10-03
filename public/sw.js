/* Push content and navigation are deliberately fixed: no private context is shown. */
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Intavro', {
    body: 'У вас новое уведомление в Intavro', data: {url: '/notifications'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/notifications'));
});
