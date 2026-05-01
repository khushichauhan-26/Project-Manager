# Project Tracker

A web application to manage projects, assign tasks, and track progress — all in one place.

## What it does

Project Tracker lets teams organize their work with role-based access control. Users can sign up as an **Admin** or **Member**. Admins can create projects, add team members, and manage tasks. Members can view projects they belong to and update task statuses.

## Features

- **Authentication** — Signup and login with secure JWT tokens
- **Project Management** — Create projects and add team members
- **Task Management** — Create tasks with title, priority (Low/Medium/High), due date, and assign them to team members
- **Task Status Tracking** — Update task status between TODO, IN PROGRESS, and DONE
- **Dashboard** — View total tasks, overdue tasks, and tasks assigned to you
- **Role-Based Access** — Admins have full control; Members have limited access

## Tech Stack

- **Backend:** Node.js, Express.js, PostgreSQL
- **Frontend:** HTML, CSS, JavaScript
- **Deployed on:** Railway
