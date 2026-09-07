#!/usr/bin/env node

/**
 * Benchmark Dataset Generator
 * Generates a realistic CSV dataset with strictly unique recipient names
 * for certificate generation performance testing.
 *
 * Usage:
 *   node scripts/generate-benchmark-csv.mjs [count] [outputPath]
 *   npm run generate:benchmark
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const count = parseInt(process.argv[2] || '2000', 10);
const outputPath =
  process.argv[3] ||
  path.resolve(__dirname, `../demo-data/benchmark_${count}.csv`);

const FIRST_NAMES = [
  'Aaliyah', 'Aaron', 'Abigail', 'Adam', 'Aditi', 'Adrian', 'Aidan', 'Alex',
  'Alexander', 'Amara', 'Amelia', 'Andre', 'Angela', 'Anthony', 'Aria', 'Arjun',
  'Arthur', 'Asher', 'Aurora', 'Austin', 'Ava', 'Benjamin', 'Brandon', 'Brianna',
  'Caleb', 'Cameron', 'Carlos', 'Charlotte', 'Chloe', 'Christian', 'Claire', 'Connor',
  'Daniel', 'David', 'Derek', 'Devon', 'Dominic', 'Dylan', 'Eleanor', 'Elena',
  'Eli', 'Elijah', 'Elizabeth', 'Ella', 'Emily', 'Emma', 'Ethan', 'Evan',
  'Gabriel', 'Grace', 'Hannah', 'Harper', 'Harrison', 'Henry', 'Ian', 'Isaac',
  'Isabella', 'Jack', 'Jacob', 'James', 'Jasmine', 'Jayden', 'John', 'Jonathan',
  'Jordan', 'Joseph', 'Joshua', 'Julia', 'Julian', 'Kai', 'Karan', 'Katelyn',
  'Kayla', 'Kevin', 'Kiran', 'Kyle', 'Layla', 'Leo', 'Liam', 'Logan',
  'Lucas', 'Luke', 'Luna', 'Madeline', 'Marcus', 'Mason', 'Mateo', 'Maya',
  'Michael', 'Mila', 'Nathan', 'Nicholas', 'Noah', 'Nolan', 'Nora', 'Oliver',
  'Olivia', 'Owen', 'Priya', 'Rafael', 'Rohan', 'Ruby', 'Ryan', 'Sam',
  'Samuel', 'Santiago', 'Sarah', 'Sebastian', 'Sophia', 'Suresh', 'Tyler', 'Valerie',
  'Victor', 'Victoria', 'Vikram', 'William', 'Wyatt', 'Xavier', 'Zachary', 'Zoe'
];

const LAST_NAMES = [
  'Adams', 'Agarwal', 'Alvarez', 'Anderson', 'Baker', 'Banerjee', 'Barnes', 'Bell',
  'Bennett', 'Bhatia', 'Brooks', 'Brown', 'Campbell', 'Castillo', 'Chakraborty', 'Chen',
  'Clark', 'Coleman', 'Collins', 'Cooper', 'Cox', 'Das', 'Davis', 'Diaz',
  'Edwards', 'Evans', 'Fernandez', 'Flores', 'Foster', 'Garcia', 'Ghosh', 'Gomez',
  'Gonzalez', 'Goswami', 'Gray', 'Green', 'Gupta', 'Hall', 'Harris', 'Hayes',
  'Henderson', 'Hernandez', 'Hill', 'Howard', 'Hughes', 'Iyer', 'Jackson', 'James',
  'Jenkins', 'Johnson', 'Jones', 'Joshi', 'Kapoor', 'Kelly', 'Kim', 'King',
  'Kulkarni', 'Kumar', 'Lee', 'Lewis', 'Long', 'Lopez', 'Martin', 'Martinez',
  'Miller', 'Mitra', 'Moore', 'Morales', 'Morgan', 'Mukherjee', 'Murphy', 'Myers',
  'Nair', 'Nelson', 'Nguyen', 'O\'Connor', 'Okafor', 'Ortiz', 'Park', 'Patel',
  'Perez', 'Peterson', 'Phillips', 'Powell', 'Price', 'Ramachandran', 'Ramirez', 'Rao',
  'Reed', 'Richardson', 'Rivera', 'Roberts', 'Rodriguez', 'Ross', 'Roy', 'Russell',
  'Sanchez', 'Sanders', 'Sengupta', 'Sharma', 'Silva', 'Smith', 'Stewart', 'Sullivan',
  'Taylor', 'Thomas', 'Torres', 'Turner', 'Vance', 'Venkatesh', 'Verma', 'Walker',
  'Wang', 'Ward', 'Watson', 'White', 'Williams', 'Wilson', 'Wood', 'Wright', 'Young', 'Zhang'
];

const COURSES = [
  'Full Stack Web Development',
  'Data Science & AI Bootcamp',
  'Cloud Architecture Mastery',
  'Cybersecurity Defense Essentials',
  'UI/UX Product Design Masterclass',
  'Machine Learning Ops (MLOps)',
  'Modern DevOps & Kubernetes',
  'Blockchain & Smart Contracts',
  'Distributed Systems Engineering',
  'Next.js & React 19 Enterprise Patterns',
  'Autonomous Systems & Robotics',
  'Applied Quantum Computing'
];

const EVENTS = [
  'Global Tech Summit 2026',
  'AI Innovators Hackathon',
  'CloudCon Annual 2026',
  'CyberSec Expo 2026',
  'DesignSprint 2026',
  'DevOps Days 2026',
  'Web3 Builders Summit',
  'FutureTech Leadership Forum'
];

const GRADES = ['Distinction', 'Honors', 'Excellence', 'Merit', 'High Distinction'];

const ROLES = [
  'Attendee',
  'Participant',
  'Winner - 1st Place',
  'Runner Up',
  'Speaker',
  'Track Finalist',
  'Honorary Fellow'
];

const ORGANIZATIONS = [
  'Acme Corporation',
  'Nexus Labs',
  'Horizon Systems',
  'Vanguard Security',
  'PixelCraft Studio',
  'Quantum Dynamics',
  'NovaTech Global',
  'Apex Digital',
  'Synthetix AI',
  'Starlight Ventures',
  'OmniCorp Research',
  'Aether Interactive'
];

function sanitizeForCsv(val) {
  const str = String(val ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function generateUniqueNames(targetCount) {
  const combinations = [];
  for (const first of FIRST_NAMES) {
    for (const last of LAST_NAMES) {
      combinations.push(`${first} ${last}`);
    }
  }

  // Deterministic shuffle with fixed seed for reproducible realistic variety
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = combinations.length - 1; i > 0; i--) {
    const j = Math.floor(pseudoRandom() * (i + 1));
    [combinations[i], combinations[j]] = [combinations[j], combinations[i]];
  }

  const names = new Set();
  for (const name of combinations) {
    names.add(name);
    if (names.size >= targetCount) break;
  }

  // Fallback with middle initials if count exceeds combination pool
  const MIDDLE_INITIALS = ['A.', 'B.', 'C.', 'D.', 'E.', 'J.', 'K.', 'M.', 'R.', 'S.', 'T.', 'V.'];
  let middleIdx = 0;
  while (names.size < targetCount) {
    const first = FIRST_NAMES[Math.floor(pseudoRandom() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(pseudoRandom() * LAST_NAMES.length)];
    const middle = MIDDLE_INITIALS[middleIdx % MIDDLE_INITIALS.length];
    middleIdx++;
    names.add(`${first} ${middle} ${last}`);
  }

  return Array.from(names);
}

function generateRecords(targetCount) {
  const uniqueNames = generateUniqueNames(targetCount);
  const rows = [];

  const headers = [
    'Name',
    'Email',
    'Course',
    'Event',
    'Date',
    'Certificate_ID',
    'Grade',
    'Role',
    'Organization'
  ];
  rows.push(headers.map(sanitizeForCsv).join(','));

  const usedEmails = new Set();

  for (let i = 0; i < targetCount; i++) {
    const name = uniqueNames[i];
    const cleanNameForEmail = name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.');
    let email = `${cleanNameForEmail}@example.com`;
    if (usedEmails.has(email)) {
      email = `${cleanNameForEmail}.${i + 1}@example.com`;
    }
    usedEmails.add(email);

    const course = COURSES[i % COURSES.length];
    const event = EVENTS[i % EVENTS.length];
    const date = 'March 15, 2026';
    const certId = `CERT-2026-${String(i + 1).padStart(4, '0')}`;
    const grade = GRADES[i % GRADES.length];
    const role = ROLES[i % ROLES.length];
    const organization = ORGANIZATIONS[i % ORGANIZATIONS.length];

    const row = [
      name,
      email,
      course,
      event,
      date,
      certId,
      grade,
      role,
      organization
    ];

    rows.push(row.map(sanitizeForCsv).join(','));
  }

  return rows.join('\n');
}

console.log(`[benchmark-csv] Generating dataset with ${count} strictly unique recipient records...`);
const csvContent = generateRecords(count);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csvContent, 'utf-8');

const stat = fs.statSync(outputPath);
const fileSizeKb = (stat.size / 1024).toFixed(1);

console.log(`[benchmark-csv] ✓ Successfully generated ${count} records!`);
console.log(`[benchmark-csv] Output file: ${outputPath} (${fileSizeKb} KB)`);
