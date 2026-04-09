import { useState, useEffect, type ReactNode } from "react";

const TOKEN_KEY = "asiawave_auth_token";

async function checkToken(token: string): Promise<boolean> {
  try {
    const r = await fetch("/api/pattern-matcher/validate-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    return d.ok === true;
  } catch {
    return false;
  }
}

async function login(password: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const r = await fetch("/api/pattern-matcher/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return await r.json();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [status, setStatus]     = useState<"checking" | "locked" | "unlocked">("checking");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setStatus("locked"); return; }
    checkToken(token).then((ok) => setStatus(ok ? "unlocked" : "locked"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await login(password);
    if (result.ok && result.token) {
      localStorage.setItem(TOKEN_KEY, result.token);
      setStatus("unlocked");
    } else {
      setError(result.error ?? "Нэвтрэх амжилтгүй");
    }
    setLoading(false);
  }

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unlocked") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-white tracking-tight mb-1">
            Asia<span className="text-amber-400">Wave</span>
          </div>
          <div className="text-sm text-slate-400">Pattern Matcher · XAUUSD H1</div>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#161b22] border border-[#2d333b] rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Нууц үг
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              className="w-full bg-[#0f1117] border border-[#2d333b] rounded-lg px-3 py-2.5
                         text-white placeholder-slate-600 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50
                         transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed
                       text-black font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Шалгаж байна…
              </span>
            ) : (
              "Нэвтрэх"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
