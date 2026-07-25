import { signIn } from '../auth.js';

export function loginForm() {
    return {
        email: '',
        password: '',
        error: '',
        loading: false,
        async submit() {
            if (this.loading) return;
            this.error = '';
            this.loading = true;
            const result = await signIn(this.email.trim(), this.password);
            this.loading = false;
            if (!result.ok) {
                this.error = result.message || 'Sign in failed. Check your email and password.';
            }
            // On success, auth.js's onAuthStateChange fires and main.js's
            // app() picks up the new session -- this component doesn't
            // need to know what happens next.
        }
    };
}
