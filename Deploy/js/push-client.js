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
        console.log('Browser Service Worker received a push notification from the server.');
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
    // 2026-08-06: this used to guard on `!window.supabase` -- but nothing
    // in this codebase ever sets window.supabase (confirmed via a full-repo
    // search), so that check was always true and this whole function
    // silently no-op'd on every single push action, Complete included.
    // The module's own imported `supabase` client (from supabase-client.js,
    // top of this file) is what every DB call below actually uses and is
    // always ready once this module has loaded -- no guard needed.
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
        // 2026-08-06: no longer commits a fixed +1 hour here. A push
        // notification can't fit 3 duration buttons (browsers cap
        // notification actions at 2), so "Snooze" now opens a small
        // in-app picker (15/30/60 min) instead -- app() in main.js listens
        // for this event and shows it regardless of which tab is open.
        window.dispatchEvent(new CustomEvent('atlas:snooze-request', { detail: { taskId } }));
    }
}

// Applies a chosen snooze duration to a task's scheduled_date + time
// together, not scheduled_time alone (2026-08-06 fix). The old version
// only ever touched scheduled_time, computed off "now" rather than the
// task's own scheduled_date -- a snooze that crossed midnight silently
// wrote a time that no longer matched the task's real date, and a task
// already overdue by more than a day got snoozed relative to the wrong
// day entirely. This combines the task's real scheduled_date+scheduled_time
// into one Date, adds the offset, then writes both fields back.
export async function applySnooze(taskId, minutes) {
    if (!taskId) return { ok: false, error: 'No task selected' };
    try {
        const { data: task, error: fetchErr } = await supabase
            .from('atlas_tasks')
            .select('scheduled_date, scheduled_time')
            .eq('id', taskId)
            .single();
        if (fetchErr || !task) throw new Error(fetchErr?.message || 'Task not found');

        const baseDate = task.scheduled_date || new Date().toLocaleDateString('en-CA');
        const baseTime = task.scheduled_time || '00:00:00';
        const dt = new Date(`${baseDate}T${baseTime}`);
        dt.setMinutes(dt.getMinutes() + minutes);

        const pad = n => String(n).padStart(2, '0');
        const newDate = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const newTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;

        const { error } = await supabase
            .from('atlas_tasks')
            .update({ scheduled_date: newDate, scheduled_time: newTime })
            .eq('id', taskId);
        if (error) throw new Error(error.message);

        if (window.undoToast) window.undoToast.show(`Snoozed ${minutes} minutes`);
        if (typeof window.loadTasks === 'function') window.loadTasks();
        return { ok: true };
    } catch (e) {
        console.error('Snooze failed:', e);
        return { ok: false, error: e.message };
    }
}
