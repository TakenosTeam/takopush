require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const { PORT = 3001 } = process.env;

const phyllo = axios.create({
  baseURL: 'https://api.staging.getphyllo.com/v1',
  headers: {
    'Authorization': 'Basic NzhhYjM4NzMtMWViZC00MDgzLWJjMmItOGJlMzhhMmEzNzMwOjEwYmRmY2NmLTA2ZTMtNDMyNC1hZjM2LWVkYzk5YWIyYzAxZA==',
    'Content-Type': 'application/json',
  },
});

// ─── POST /api/create-user ───────────────────────────────────────────────────
// Creates a user in Phyllo.
// Body: { name: string, external_id: string }
app.post('/api/create-user', async (req, res) => {
  const { name, external_id } = req.body;

  if (!name || !external_id) {
    return res.status(400).json({ error: 'name and external_id are required' });
  }

  try {
    const { data } = await phyllo.post('/users', { name, external_id });

    await supabase.from('phyllo_users').upsert({
      phyllo_id: data.id,
      name,
      external_id,
    }, { onConflict: 'external_id' });

    res.status(201).json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    res.status(status).json({ error: message });
  }
});

// ─── POST /api/sdk-token ─────────────────────────────────────────────────────
// Generates a Phyllo SDK token for the given user.
// Body: { user_id: string }
app.post('/api/sdk-token', async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  try {
    const { data } = await phyllo.post('/sdk-tokens', {
      user_id,
      products: ['IDENTITY', 'ENGAGEMENT'],
    });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    res.status(status).json({ error: message });
  }
});

// ─── GET /api/profile/:user_id ───────────────────────────────────────────────
// Returns the Phyllo user profile and their connected Instagram account data.
app.get('/api/profile/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    // Fetch user profile and accounts in parallel
    const [userRes, accountsRes] = await Promise.all([
      phyllo.get(`/users/${user_id}`),
      phyllo.get('/accounts', { params: { user_id } }),
    ]);

    const user = userRes.data;
    const accounts = accountsRes.data?.data ?? [];

    // Find the Instagram account if it exists
    const instagram = accounts.find(
      (acc) => acc.work_platform?.name?.toLowerCase() === 'instagram'
    ) ?? null;

    res.json({ user, instagram, accounts });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    res.status(status).json({ error: message });
  }
});

// ─── GET /api/instagram/:user_id ─────────────────────────────────────────────
// Returns Instagram identity and engagement data for the given Phyllo user.
const INSTAGRAM_PLATFORM_ID = '9bb8913b-ddd9-430b-a66a-d74d846e6c66';

// ─── GET /api/instagram?username=xxx ────────────────────────────────────────
// Obtiene métricas de Instagram via RapidAPI (sin OAuth del usuario)
app.get('/api/instagram', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username requerido' });

  try {
    const igUrl = `https://www.instagram.com/${username.replace('@', '')}/`;
    const { data: raw } = await axios.get(
      'https://instagram-statistics-api.p.rapidapi.com/community',
      {
        params: { url: igUrl },
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'instagram-statistics-api.p.rapidapi.com',
        },
      }
    );

    const d = raw?.data;
    if (!d) return res.status(404).json({ error: 'Perfil no encontrado' });

    const result = {
      username: d.screenName,
      full_name: d.name,
      bio: d.description,
      followers: d.usersCount,
      is_verified: d.verified,
      pct_fake: d.pctFakeFollowers,
      image_url: d.image,
      profile_url: d.url,
    };

    // Guardar en Supabase
    await supabase.from('instagram_profiles').upsert({
      phyllo_user_id: d.groupID,
      username: result.username,
      full_name: result.full_name,
      bio: result.bio,
      is_verified: result.is_verified,
      is_business: false,
      followers: result.followers,
      following: null,
      posts: null,
      image_url: result.image_url,
      profile_url: result.profile_url,
      scanned_at: new Date().toISOString(),
    }, { onConflict: 'phyllo_user_id' });

    await supabase.from('scan_history').insert({
      phyllo_user_id: d.groupID,
      platform: 'instagram',
      followers: result.followers,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ─── GET /api/tiktok?username=xxx ───────────────────────────────────────────
// Obtiene métricas de TikTok via RapidAPI por username (sin OAuth)
app.get('/api/tiktok', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username requerido' });

  const clean = username.replace('@', '').trim();

  try {
    const { data: raw } = await axios.get(
      'https://tiktok-scraper7.p.rapidapi.com/user/info',
      {
        params: { uniqueId: clean },
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'tiktok-scraper7.p.rapidapi.com',
        },
      }
    );

    const user = raw?.data?.user;
    const stats = raw?.data?.stats;
    if (!user) return res.status(404).json({ error: 'Perfil no encontrado' });

    const result = {
      username: user.uniqueId,
      full_name: user.nickname,
      bio: user.signature,
      is_verified: user.verified,
      followers: stats?.followerCount || 0,
      following: stats?.followingCount || 0,
      posts: stats?.videoCount || 0,
      likes: stats?.heartCount || 0,
      image_url: user.avatarLarger || user.avatarMedium,
    };

    // Guardar en Supabase
    await supabase.from('tiktok_profiles').upsert({
      phyllo_user_id: user.id || clean,
      username: result.username,
      full_name: result.full_name,
      bio: result.bio,
      is_verified: result.is_verified,
      is_business: false,
      followers: result.followers,
      following: result.following,
      posts: result.posts,
      image_url: result.image_url,
      scanned_at: new Date().toISOString(),
    }, { onConflict: 'phyllo_user_id' });

    await supabase.from('scan_history').insert({
      phyllo_user_id: user.id || clean,
      platform: 'tiktok',
      followers: result.followers,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ─── GET /api/tiktok/:user_id ────────────────────────────────────────────────
// Returns TikTok identity and engagement data for the given Phyllo user (legacy).
const TIKTOK_PLATFORM_ID = 'de55aeec-0dc8-4119-bf90-16b3d1f0c987';

app.get('/api/tiktok/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const { data } = await phyllo.get('/profiles', {
      params: { user_id, work_platform_id: TIKTOK_PLATFORM_ID },
    });
    const profile = data?.data?.[0];
    if (!profile) {
      return res.status(404).json({ error: 'No TikTok profile found' });
    }
    const result = {
      username: profile.username,
      full_name: profile.full_name,
      bio: profile.introduction,
      is_verified: profile.is_verified,
      is_business: profile.is_business,
      followers: profile.reputation?.follower_count,
      following: profile.reputation?.following_count,
      posts: profile.reputation?.content_count,
      image_url: profile.image_url,
      url: profile.url,
    };

    // Guardar / actualizar perfil TikTok en Supabase
    await supabase.from('tiktok_profiles').upsert({
      phyllo_user_id: user_id,
      username: result.username,
      full_name: result.full_name,
      bio: result.bio,
      is_verified: result.is_verified,
      is_business: result.is_business,
      followers: result.followers,
      following: result.following,
      posts: result.posts,
      image_url: result.image_url,
      profile_url: result.url,
      scanned_at: new Date().toISOString(),
    }, { onConflict: 'phyllo_user_id' });

    // Registrar en historial
    await supabase.from('scan_history').insert({
      phyllo_user_id: user_id,
      platform: 'tiktok',
      followers: result.followers,
      following: result.following,
      posts: result.posts,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ─── GET /api/debug/db ───────────────────────────────────────────────────────
// Devuelve el contenido actual de las tres tablas de Supabase.
app.get('/api/debug/db', async (_req, res) => {
  const [users, igProfiles, ttProfiles, history, submissions] = await Promise.all([
    supabase.from('phyllo_users').select('*').order('created_at', { ascending: false }),
    supabase.from('instagram_profiles').select('*').order('scanned_at', { ascending: false }),
    supabase.from('tiktok_profiles').select('*').order('scanned_at', { ascending: false }),
    supabase.from('scan_history').select('*').order('scanned_at', { ascending: false }),
    supabase.from('submissions').select('*').order('submitted_at', { ascending: false }),
  ]);
  res.json({
    phyllo_users:       { data: users.data,       error: users.error?.message },
    instagram_profiles: { data: igProfiles.data,  error: igProfiles.error?.message },
    tiktok_profiles:    { data: ttProfiles.data,  error: ttProfiles.error?.message },
    scan_history:       { data: history.data,     error: history.error?.message },
    submissions:        { data: submissions.data, error: submissions.error?.message },
  });
});

// ─── POST /api/submit-reward ─────────────────────────────────────────────────
// Guarda la entrega del influencer: taketag + link de contenido + monto oferta
app.post('/api/submit-reward', async (req, res) => {
  const { taketag, content_link, offer_amount, user_id } = req.body;
  if (!taketag) return res.status(400).json({ error: 'taketag requerido' });

  const { data, error } = await supabase
    .from('submissions')
    .insert([{ taketag, content_link: content_link || null, offer_amount: offer_amount || null, user_id: user_id || null }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, submission: data });
});

// ─── GET /api/earnings?taketag=xxx ──────────────────────────────────────────
// Devuelve todas las submissions de un taketag dado
app.get('/api/earnings', async (req, res) => {
  const { taketag } = req.query;
  const query = supabase.from('submissions').select('*').order('submitted_at', { ascending: false });
  if (taketag) query.ilike('taketag', taketag);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ submissions: data || [] });
});

// ─── ADMIN middleware ────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'takenos2024';

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ─── GET /api/admin/submissions ──────────────────────────────────────────────
app.get('/api/admin/submissions', adminAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('submitted_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ submissions: data || [] });
});

// ─── PATCH /api/admin/submissions/:id ────────────────────────────────────────
app.patch('/api/admin/submissions/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['pending', 'approved', 'paid', 'rejected'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  const { data, error } = await supabase
    .from('submissions')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, submission: data });
});

// ─── GET /api/admin/users ────────────────────────────────────────────────────
app.get('/api/admin/users', adminAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from('phyllo_users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

// ─── GET /admin ───────────────────────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log(`Takenos backend running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}  ← abrí esto en el celular`);
});
