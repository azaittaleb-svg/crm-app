import { useState } from 'react';
import { signInWithPopup, signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutGrid, Sparkles, Loader2, KeyRound, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');

    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/unauthorized-domain') {
        setErrorMessage(
          `Le domaine ${window.location.hostname} n'est pas autorisé dans Firebase. Ajoutez-le dans la console Firebase (Authentication > Settings > Authorized domains).`
        );
      } else if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
        setErrorMessage(
          `La fenêtre de connexion a été bloquée par le navigateur. Veuillez autoriser les pop-ups pour ce site.`
        );
      } else {
        setErrorMessage(`Erreur de connexion: ${error.message}`);
      }
    } finally {
      setTimeout(() => setIsLoggingIn(false), 1000);
    }
  };

  // Variants for staggered children animations
  const cardVariants: any = {
    hidden: { opacity: 0, y: 30, scale: 0.97 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1], // Custom premium ease-out cubic
        when: 'beforeChildren',
        staggerChildren: 0.12,
      },
    },
  };

  const itemVariants: any = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
    },
  };

  const glowVariants = {
    animate: {
      scale: [1, 1.1, 0.95, 1.05, 1],
      opacity: [0.5, 0.65, 0.45, 0.6, 0.5],
      transition: {
        duration: 12,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6 relative overflow-hidden select-none">
      {/* 1. ELEVATED AMBIENT INTERACTIVE LAYER (Slow floating luxury orbs) */}
      <motion.div
        variants={glowVariants}
        animate="animate"
        className="absolute top-[-10%] right-[-10%] w-[500px] h-[550px] bg-gradient-to-br from-indigo-500/10 to-transparent rounded-full blur-[100px] pointer-events-none"
      />

      <motion.div
        variants={glowVariants}
        animate="animate"
        className="absolute bottom-[-15%] left-[-15%] w-[600px] h-[600px] bg-gradient-to-tr from-cyan-400/8 to-transparent rounded-full blur-[120px] pointer-events-none"
        style={{ animationDelay: '3s' }}
      />

      <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-transparent rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[30%] right-[10%] w-[250px] h-[250px] bg-transparent rounded-full blur-[70px] pointer-events-none" />

      {/* Subtle overlay texture/grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1.2px,transparent_1.2px)] [background-size:24px_24px] opacity-[0.25] pointer-events-none" />

      {/* 2. CHIC COCKPIT ENTERING SHELL */}
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        className="max-w-md w-full bg-white/75 backdrop-blur-2xl rounded-[2.5rem] p-10 md:p-12 shadow-[0_20px_50px_rgba(9,13,26,0.06)] border border-slate-200/50 text-center relative z-10 space-y-10"
      >
        {/* Subtle decorative security shield pill at the top */}
        <motion.div
          variants={itemVariants}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-200/60 rounded-full text-[9px] font-extrabold uppercase tracking-widest text-slate-500 font-mono shadow-3xs"
        >
          <KeyRound size={10} className="text-zinc-550" />
          <span>Accès Autorisé Uniquement</span>
        </motion.div>

        {/* Dynamic Glowing Logo Capsule */}
        <motion.div variants={itemVariants} className="flex justify-center relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-2xl blur-lg opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
          <motion.div
            whileHover={{ scale: 1.05, rotate: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-16 h-16 bg-[#090D1A] rounded-2xl flex items-center justify-center border border-white/10 shadow-xl transition-all cursor-pointer relative"
          >
            <LayoutGrid size={24} className="text-white" strokeWidth={2} />
            <Sparkles
              size={12}
              className="text-[#03c3ec] dark:text-[#03c3ec] absolute top-2.5 right-2.5 animate-pulse"
            />
          </motion.div>
        </motion.div>

        {/* Premium Brand Header Block */}
        <div className="space-y-3">
          <motion.h1
            variants={itemVariants}
            className="text-xl md:text-2xl font-extrabold text-[#090D1A] tracking-normal font-display leading-tight"
          >
            Cockpit d'Exploitation
          </motion.h1>
          <motion.div
            variants={itemVariants}
            className="w-20 h-1 bg-gradient-to-r from-indigo-500 to-cyan-400 mx-auto rounded-full"
          />
          <motion.p
            variants={itemVariants}
            className="text-slate-500 font-extrabold uppercase tracking-[0.16em] text-[9.5px] font-mono"
          >
            GESTION COMMERCIALE & CRÉDITS
          </motion.p>
        </div>

        {/* Error Feedback Message */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="p-3.5 bg-rose-50 border border-rose-200/80 rounded-xl text-left flex items-start gap-2.5 text-xs text-rose-700 font-medium"
            >
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-500" />
              <span>{errorMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Connect Button */}
        <motion.div variants={itemVariants} className="pt-2">
          {isLoggingIn ? (
            <button
              disabled
              className="w-full flex items-center justify-center gap-3 bg-[#090D1A] text-white py-4 rounded-2xl font-bold uppercase tracking-wider text-xs border border-white/5 shadow-xl shadow-slate-200/50 opacity-90"
            >
              <Loader2 size={16} className="animate-spin text-[#03c3ec] dark:text-[#03c3ec]" />
              <span>Authentification...</span>
            </button>
          ) : (
            <motion.button
              whileHover={{
                scale: 1.02,
                y: -1,
                boxShadow: '0 12px 24px -10px rgba(9, 13, 26, 0.3)',
              }}
              whileTap={{ scale: 0.98 }}
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-4 bg-[#090D1A] hover:bg-[#121930] text-white py-4 rounded-2xl font-bold uppercase tracking-wider text-xs transition-all shadow-lg border border-white/5 px-8 font-sans cursor-pointer"
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                className="w-4 h-4 brightness-0 invert-0"
              />
              <span>Se connecter avec Google</span>
            </motion.button>
          )}
        </motion.div>

        {/* Elegant Minimal Footer */}
        <motion.div variants={itemVariants} className="pt-4 border-t border-slate-100">
          <p className="text-slate-400 text-[8.5px] font-bold uppercase tracking-[0.3em] font-mono leading-none">
            Système Sécurisé • v1.3.0
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
