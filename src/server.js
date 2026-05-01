require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { z } = require("zod");

const { pool, initDb } = require("./db");
const { requireAuth, requireGlobalAdmin } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const signUpSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(100),
  role: z.enum(["ADMIN", "MEMBER"]).optional().default("MEMBER"),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(100),
});

const projectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(600).optional().default(""),
});

const addMemberSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["ADMIN", "MEMBER"]).optional().default("MEMBER"),
});

const taskSchema = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  details: z.string().trim().max(1000).optional().default(""),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("MEDIUM"),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional().default("TODO"),
  dueDate: z.string().date().optional().nullable(),
  assignedTo: z.number().int().positive().optional().nullable(),
});

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function isProjectMember(userId, projectId) {
  const result = await pool.query(
    "SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2 LIMIT 1",
    [userId, projectId]
  );
  return result.rows[0] || null;
}

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  const { name, email, password, role } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name, email, passwordHash, role]
    );
    const user = result.rows[0];
    const token = createToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    if (String(error.message).includes("duplicate key")) {
      return res.status(409).json({ message: "Email already exists." });
    }
    return res.status(500).json({ message: "Unable to create user." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  const { email, password } = parsed.data;
  const result = await pool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
  const user = result.rows[0];

  if (!user) return res.status(401).json({ message: "Invalid credentials." });
  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) return res.status(401).json({ message: "Invalid credentials." });

  const token = createToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT id, name, email, role FROM users WHERE id = $1", [req.user.id]);
  return res.json(result.rows[0]);
});

app.post("/api/projects", requireAuth, async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

  const { name, description } = parsed.data;
  const projectResult = await pool.query(
    "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *",
    [name, description, req.user.id]
  );
  const project = projectResult.rows[0];

  await pool.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'ADMIN') ON CONFLICT DO NOTHING",
    [project.id, req.user.id]
  );

  return res.status(201).json(project);
});

app.get("/api/projects", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT p.*,
      (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE pm.user_id = $1
     ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  return res.json(result.rows);
});

app.post("/api/projects/:id/members", requireAuth, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ message: "Invalid project id." });
  }

  const membership = await isProjectMember(req.user.id, projectId);
  if (!membership || membership.role !== "ADMIN") {
    return res.status(403).json({ message: "Project admin role is required." });
  }

  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

  const { email, role } = parsed.data;
  const userResult = await pool.query("SELECT id, name, email FROM users WHERE email = $1 LIMIT 1", [email]);
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ message: "User not found." });

  await pool.query(
    "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role",
    [projectId, user.id, role]
  );

  return res.status(201).json({ message: "Member added/updated.", user: { ...user, role } });
});

app.get("/api/projects/:id/members", requireAuth, async (req, res) => {
  const projectId = Number(req.params.id);
  const membership = await isProjectMember(req.user.id, projectId);
  if (!membership) return res.status(403).json({ message: "Not a project member." });

  const result = await pool.query(
    `SELECT u.id, u.name, u.email, pm.role
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY pm.role ASC, u.name ASC`,
    [projectId]
  );
  return res.json(result.rows);
});

app.post("/api/tasks", requireAuth, async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

  const data = parsed.data;
  const membership = await isProjectMember(req.user.id, data.projectId);
  if (!membership) return res.status(403).json({ message: "Not a project member." });

  if (data.assignedTo) {
    const assigneeMembership = await isProjectMember(data.assignedTo, data.projectId);
    if (!assigneeMembership) {
      return res.status(400).json({ message: "Assigned user is not part of this project." });
    }
  }

  const result = await pool.query(
    `INSERT INTO tasks (project_id, title, details, priority, status, due_date, created_by, assigned_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.projectId,
      data.title,
      data.details,
      data.priority,
      data.status,
      data.dueDate,
      req.user.id,
      data.assignedTo,
    ]
  );

  return res.status(201).json(result.rows[0]);
});

app.get("/api/tasks", requireAuth, async (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ message: "Valid projectId query param is required." });
  }

  const membership = await isProjectMember(req.user.id, projectId);
  if (!membership) return res.status(403).json({ message: "Not a project member." });

  const result = await pool.query(
    `SELECT t.*, u1.name AS created_by_name, u2.name AS assigned_to_name
     FROM tasks t
     JOIN users u1 ON u1.id = t.created_by
     LEFT JOIN users u2 ON u2.id = t.assigned_to
     WHERE t.project_id = $1
     ORDER BY
       CASE t.status
         WHEN 'TODO' THEN 1
         WHEN 'IN_PROGRESS' THEN 2
         ELSE 3
       END,
       t.created_at DESC`,
    [projectId]
  );
  return res.json(result.rows);
});

app.patch("/api/tasks/:id/status", requireAuth, async (req, res) => {
  const taskId = Number(req.params.id);
  const status = z.enum(["TODO", "IN_PROGRESS", "DONE"]).safeParse(req.body.status);
  if (!status.success) return res.status(400).json({ message: "Invalid status." });

  const taskResult = await pool.query("SELECT id, project_id FROM tasks WHERE id = $1", [taskId]);
  const task = taskResult.rows[0];
  if (!task) return res.status(404).json({ message: "Task not found." });

  const membership = await isProjectMember(req.user.id, task.project_id);
  if (!membership) return res.status(403).json({ message: "Not a project member." });

  const updated = await pool.query("UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *", [
    status.data,
    taskId,
  ]);
  return res.json(updated.rows[0]);
});

app.get("/api/dashboard", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT t.status, t.due_date, t.assigned_to
     FROM tasks t
     JOIN project_members pm ON pm.project_id = t.project_id
     WHERE pm.user_id = $1`,
    [req.user.id]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const summary = {
    totalTasks: 0,
    todo: 0,
    inProgress: 0,
    done: 0,
    overdue: 0,
    assignedToMe: 0,
  };

  for (const row of result.rows) {
    summary.totalTasks += 1;
    if (row.status === "TODO") summary.todo += 1;
    if (row.status === "IN_PROGRESS") summary.inProgress += 1;
    if (row.status === "DONE") summary.done += 1;
    if (row.assigned_to === req.user.id) summary.assignedToMe += 1;

    if (row.due_date && row.status !== "DONE") {
      const dueDate = new Date(row.due_date);
      if (dueDate < today) summary.overdue += 1;
    }
  }

  return res.json(summary);
});

app.post("/api/admin/promote/:userId", requireAuth, requireGlobalAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id." });
  }
  const result = await pool.query("UPDATE users SET role = 'ADMIN' WHERE id = $1 RETURNING id, name, email, role", [
    userId,
  ]);
  if (!result.rows[0]) return res.status(404).json({ message: "User not found." });
  return res.json(result.rows[0]);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required.");
  }

  await initDb();
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

start().catch((error) => {
  const details =
    error instanceof Error
      ? error.stack || error.message
      : typeof error === "object"
      ? JSON.stringify(error, null, 2)
      : String(error);
  console.error("Failed to start server:", details);
  process.exit(1);
});
