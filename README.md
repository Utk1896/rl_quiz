# 🕷️ RL Quiz — Probability Basics

A Spider-Man themed quiz platform for RL Assignment 1.

## Features
- One-time attempt per student (name + roll number)
- Interactive inputs: sliders, MCQ, matrix, number fields
- Auto-graded with instant results + full solutions
- Students only see their own score
- Mentor dashboard (password: `mentor2026`) shows all submissions

---

## Running Locally

### Prerequisites
- Node.js 18+ installed

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
# http://localhost:3000
```

The SQLite database is created automatically at `data/quiz.db`.

---

## Deploy to GitHub + Railway

### Step 1 — Push to GitHub

```bash
# Initialize git repo
git init
git add .
git commit -m "Initial commit: RL Quiz platform"

# Create a new repo on github.com (name it e.g. rl-quiz)
# Then:
git remote add origin https://github.com/YOUR_USERNAME/rl-quiz.git
git branch -M main
git push -u origin main
```

### Step 2 — Deploy on Railway

1. Go to **https://railway.app** and sign in (use GitHub login)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `rl-quiz` repo
4. Railway will auto-detect the Dockerfile and build it

### Step 3 — Add a Persistent Volume (IMPORTANT)

The SQLite database must survive redeploys:

1. In Railway dashboard, click your service
2. Go to **Settings → Volumes**
3. Click **Add Volume**
4. Set Mount Path to `/app/data`
5. Click **Add**
6. Railway will redeploy automatically

### Step 4 — Get Your URL

1. In Railway dashboard → your service → **Settings → Networking**
2. Click **Generate Domain**
3. Your site will be live at `https://rl-quiz-production-xxxx.up.railway.app`

---

## Mentor Access

- Click the **⚙ Mentor** button (top right of any page)
- Password: `mentor2026`
- See all submissions, scores, per-question breakdown
- Click any row to see detailed part-by-part breakdown

---

## Grading

| Question | Topic | Max |
|---|---|---|
| Q1 | Continuous PDF, Geometric Distribution | 5 |
| Q2 | Hypergeometric, Binomial | 5 |
| Q3 | Markov, Chebyshev, Chernoff, Hoeffding | 5 |
| Q4 | Markov Chains, MDPs | 5 |
| Q5 | Random Walks, Martingales | 5 |
| **Total** | | **25** |
