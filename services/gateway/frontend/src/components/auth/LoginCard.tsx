import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function LoginCard() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Probes backend mesh directly during network failures
  const checkGatewayConnectivity = async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      
      await window.fetch('/api/devices', { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      return true;
    } catch (e) {
      return false;
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSubmitting(true);

    try {
      if (isRegister) {
        const res = await register(username, password);
        if (res.success) {
          setSuccess('Identity initialized! Proceed to Login.');
          setIsRegister(false);
          setPassword(''); 
        } else {
          // Robust checking loop for registration errors
          if (res.error && typeof res.error === 'object') {
            const errorObj = res.error as any;
            if (Array.isArray(errorObj.detail)) {
              setError(errorObj.detail.map((d: any) => d.msg).join(', '));
            } else if (errorObj.detail) {
              setError(String(errorObj.detail));
            } else {
              setError(JSON.stringify(res.error));
            }
          } else {
            setError(res.error || 'Registration failed.');
          }
        }
      } else {
        const res = await login(username, password);
        if (!res.success) {
          // COMPLETE STABILITY FIX: Handle nested validation arrays safely without passing objects to the DOM
          if (res.error && typeof res.error === 'object') {
            const errorObj = res.error as any;
            
            // Check if it matches the standard nested detail array array format from your payload
            if (Array.isArray(errorObj.detail)) {
              setError(errorObj.detail.map((d: any) => d.msg).join(', '));
            } else if (errorObj.detail) {
              setError(String(errorObj.detail));
            } else {
              setError(JSON.stringify(res.error));
            }
          } else {
            setError(res.error || 'Invalid username or password.');
          }
        }
      }
    } catch (err) {
      const isGatewayAlive = await checkGatewayConnectivity();
      if (!isGatewayAlive) {
        setError('⚠️ Gateway Mesh Unreachable – Verify local host docker-compose stability and container availability.');
      } else {
        setError('A critical gateway communication error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleMode = () => {
    setIsRegister(!isRegister);
    setError('');
    setSuccess('');
    setUsername('');
    setPassword('');
    setCapsLockActive(false);
  };

  const checkModifiers = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockActive(e.getModifierState('CapsLock'));
  };

  return (
    <div className="min-h-screen bg-neutral-950 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-950/20 via-neutral-950 to-neutral-950 flex items-center justify-center p-4 text-neutral-100 font-sans selection:bg-blue-500/30">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800/80 rounded-2xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-sm animate-in fade-in zoom-in-95 duration-300">
        
        {/* Header Section */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl mb-3 border border-blue-500/10 shadow-inner">
            <Lock size={22} className="animate-pulse" style={{ animationDuration: '3s' }} />
          </div>
          <h2 className="text-xl font-medium tracking-tight text-neutral-100">
            {isRegister ? 'Create System Identity' : 'Authenticate Dashboard Context'}
          </h2>
          <p className="text-xs text-neutral-400 mt-1 max-w-[280px]">
            {isRegister 
              ? 'Create an account for your Smart Home os.' 
              : 'Sign in to access your smart home os.'}
          </p>
        </div>

        {/* Status Messaging Block */}
        <div aria-live="assertive" className="min-h-[48px] mb-2 flex items-center justify-center">
          {error && (
            <p className="w-full text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200">
              {error}
            </p>
          )}
          {success && (
            <p className="w-full text-xs font-medium text-green-400 bg-green-500/10 border border-green-500/20 p-3 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200">
              {success}
            </p>
          )}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-medium text-neutral-400 mb-1.5 cursor-pointer">
              Username
            </label>
            <input 
              id="username"
              type="text" 
              required 
              disabled={isSubmitting}
              autoComplete="username"
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 rounded-xl p-3 text-sm transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 disabled:opacity-50 placeholder:text-neutral-600"
              placeholder="e.g., admin"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-neutral-400 mb-1.5 cursor-pointer">
              Password
            </label>
            <div className="relative">
              <input 
                id="password"
                type={showPassword ? 'text' : 'password'} 
                required 
                disabled={isSubmitting}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password} 
                onChange={e => setPassword(e.target.value)}
                onKeyUp={checkModifiers}
                onKeyDown={checkModifiers}
                className="w-full bg-neutral-950 border border-neutral-800 text-neutral-100 rounded-xl pl-3 pr-11 p-3 text-sm transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 disabled:opacity-50 placeholder:text-neutral-600"
                placeholder="••••••••"
              />
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors focus:outline-none disabled:opacity-30 p-1 rounded-md"
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {capsLockActive && (
              <span className="text-[10px] text-amber-400 mt-1.5 block font-medium animate-pulse">
                ⚠️ Warning: Caps Lock is active on your device.
              </span>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-medium rounded-xl p-3 text-sm transition-all duration-200 shadow-lg shadow-blue-600/10 active:scale-[0.99] flex items-center justify-center gap-2 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>{isRegister ? 'Initializing Identity...' : 'Authenticating...'}</span>
              </>
            ) : (
              <span>{isRegister ? 'Initialize' : 'Sign In'}</span>
            )}
          </button>
        </form>

        <button 
          type="button"
          disabled={isSubmitting}
          onClick={handleToggleMode} 
          className="w-full text-center text-xs text-neutral-500 hover:text-neutral-300 mt-5 transition-colors disabled:opacity-30 cursor-pointer focus:outline-none focus:underline"
        >
          {isRegister ? 'Already registered? Log in' : 'Request new account'}
        </button>
      </div>
    </div>
  );
}


