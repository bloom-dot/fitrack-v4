/**
 * FiTrack - Envoi d'une notification push
 *
 * POST /api/send-push  { user_id, title, body, url }
 * Interne uniquement (appelé depuis cron ou depuis api/challenge-notify)
 * Protégé par le header X-Cron-Secret.
 *
 * Variables d'environnement Vercel requises :
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wszhbpsuujcgjnvvtgfv.supabase.co";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:fernandmani61@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  const secret = req.headers["x-cron-secret"];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const { user_id, title, body, url } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id requis" });

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", user_id);

  if (!subs?.length) return res.status(200).json({ sent: 0 });

  const payload = JSON.stringify({ title: title || "FiTrack", body: body || "", url: url || "/" });
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    })
  );

  return res.status(200).json({ sent });
}
