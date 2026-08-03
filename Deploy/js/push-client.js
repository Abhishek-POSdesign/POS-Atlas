import { DB } from './db.js';
import { supabase } from './supabase-client.js';

const PUBLIC_VAPID_KEY = 'BL12XRcZgRHzKZxumH9Qh-ft0FDAblQSTN7AElr-yqyaNfKraAJtg6CnxJoEE5VIuB2hips3DNfgP14zkEn7Lng';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export const PushClient = {
    status: 'Checking...',
    enabled: false,
    
    async checkStatus() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            this.status = 'Not supported';
            this.enabled = false;
            return;
        }

        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
            this.status = 'SW not registered';
            this.enabled = false;
            return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            this.status = 'Enabled';
            this.enabled = true;
        } else {
            this.status = 'Off';
            this.enabled = false;
        }
        this._updateUI();
    },

    async toggle() {
        if (this.status === 'Not supported') return;
        
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration.pushManager.getSubscription();

        try {
            if (subscription) {
                await subscription.unsubscribe();
                await this.removeSubscriptionFromDB(subscription);
                this.status = 'Off';
                this.enabled = false;
            } else {
                this.status = 'Requesting...';
                this._updateUI();
                
                const newSubscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
                });
                
                await this.saveSubscriptionToDB(newSubscription);
                this.status = 'Enabled';
                this.enabled = true;
            }
        } catch (err) {
            console.error('Push error:', err);
            this.status = 'Error';
            this.enabled = false;
        }
        this._updateUI();
    },

    async test() {
        if (!this.enabled) return;
        const testBtn = document.getElementById('btn-push-test');
        if(testBtn) testBtn.textContent = 'Sending...';
        
        try {
            const { data, error } = await supabase.functions.invoke('send-push', {
                body: { title: 'Atlas Push Test', body: 'This is a test notification from Atlas!', data: { url: '/' } }
            });
            if (error) throw error;
            if (data && data.results && data.results.length > 0 && data.results[0].success === false) {
                throw new Error('Push failed: ' + data.results[0].error);
            }
            if(testBtn) { testBtn.textContent = 'Sent!'; setTimeout(() => { testBtn.textContent = 'Test Notification'; }, 2000); }
        } catch (err) {
            console.error('Test push error:', err); alert('Push failed: ' + err.message);
            if(testBtn) { testBtn.textContent = 'Failed'; setTimeout(() => { testBtn.textContent = 'Test Notification'; }, 2000); }
        }
    },

    _updateUI() {
        const statusEl = document.getElementById('push-status-text');
        const testBtn = document.getElementById('btn-push-test');
        if (statusEl) statusEl.textContent = this.status;
        if (testBtn) testBtn.style.display = this.enabled ? 'flex' : 'none';
    },

    async saveSubscriptionToDB(subscription) {
        const subJson = subscription.toJSON();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('pos_push_subscriptions').upsert({
            user_id: user.id,
            endpoint: subJson.endpoint,
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
            updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });
    },

    async removeSubscriptionFromDB(subscription) {
        await supabase.from('pos_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    }
};

// Check on load
setTimeout(() => PushClient.checkStatus(), 1000);



navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'PUSH_RECEIVED') {
        alert('SUCCESS! The browser Service Worker received the push notification from the server! If you don\'t see a popup, Windows is blocking Chrome notifications (check Action Center / Do Not Disturb).');
    }
});


// Handle Push Actions from Service Worker
navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'ACTION_COMPLETE') {
        await handlePushAction('complete', event.data.taskId);
    } else if (event.data && event.data.type === 'ACTION_SNOOZE') {
        await handlePushAction('snooze', event.data.taskId);
    }
});

// Handle Push Actions from URL parameters (if app was closed)
window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const taskId = params.get('taskId');
    if (action && taskId) {
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        await handlePushAction(action, taskId);
    }
});

async function handlePushAction(action, taskId) {
    if (!window.supabase) return; // DB not loaded
    
    if (action === 'complete') {
        const { error } = await supabase.from('atlas_tasks')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', taskId);
        
        if (!error && window.undoToast) {
            window.undoToast.show('Task marked as completed via Push');
        }
        // If the task list is active, we should refresh it
        if (typeof window.loadTasks === 'function') {
            window.loadTasks();
        }
    } else if (action === 'snooze') {
        // Snooze adds 1 hour to scheduled_time
        const { data: task } = await supabase.from('atlas_tasks').select('scheduled_time').eq('id', taskId).single();
        if (task && task.scheduled_time) {
            const timeParts = task.scheduled_time.split(':');
            let date = new Date();
            date.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2] || 0));
            date.setHours(date.getHours() + 1); // Add 1 hour
            
            const newTime = date.getHours().toString().padStart(2, '0') + ':' + 
                            date.getMinutes().toString().padStart(2, '0') + ':00';
            
            const { error } = await supabase.from('atlas_tasks')
                .update({ scheduled_time: newTime })
                .eq('id', taskId);
                
            if (!error && window.undoToast) {
                window.undoToast.show('Task snoozed for 1 hour');
            }
            if (typeof window.loadTasks === 'function') {
                window.loadTasks();
            }
        }
    }
}
