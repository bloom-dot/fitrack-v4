/**
 * FiTrack - Cron job : rappel de pesée
 *
 * Exécuté chaque jour à 7h UTC (cf. vercel.json).
 * Cherche les utilisateurs dont le jour de pesée est aujourd'hui
 * (en fonction de leur fréquence : hebdomadaire le lundi par défaut,
 * ou bi-mensuelle les 1er et 15 de chaque mois).
 * Envoie une notification push via /api/send-push.
 *
 * Variables d'environnement requises : SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";
const SELF_URL = "https://fitrack-v4.vercel.app";

export default async function handler(req, res) {
  // Vercel vérifie automatiquement le header Authorization pour les crons,
  // mais on double-protège avec notre propre secret.
  if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=dimanche, 1=lundi
  const dayOfMonth = today.getDate();

  // Rappel hebdo le lundi (1) ou bi-mensuel les 1er/15
  const isWeighingDay = dayOfWeek === 1 || dayOfMonth === 1 || dayOfMonth === 15;
  if (!isWeighingDay) return res.status(200).json({ skipped: true });

  // Récupérer tous les user_id qui ont au moins une subscription push
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("user_id")
    .limit(500);

  if (!subs?.length) return res.status(200).json({ sent: 0 });

  const uniqueUsers = [...new Set(subs.map((s) => s.user_id))];
  let sent = 0;

  await Promise.all(
    uniqueUsers.map(async (uid) => {
      try {
        await fetch(`${SELF_URL}/api/send-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": process.env.CRON_SECRET,
          },
          body: JSON.stringify({
            user_id: uid,
            title: "⚖️ Pesée du jour — FiTrack",
            body: "N'oublie pas d'enregistrer ton poids aujourd'hui pour suivre ta progression !",
            url: "/",
          }),
        });
        sent++;
      } catch (_) {}
    })
  );

  return res.status(200).json({ sent, users: uniqueUsers.length });
}
