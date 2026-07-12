import { ToolDecorator } from '@nitrostack/core';
import { z } from 'zod';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';

// Use relative paths resolving from the root of the project directory
const CACHE_PATH = path.resolve('cache/active_student.json');
const TIMETABLE_PATH = path.resolve('cache/timetable.json');
const SYLLABUS_PATH = path.resolve('storage/course_syllabus.json');
const LOG_FILE_PATH = path.resolve('logs/scraper_exec.log');

// Local scraper fallback paths (will only run if local machine)
const SCRAPER_SCRIPT = 'C:\\Users\\rahul\\Documents\\LifeOS-Student\\scraper\\aums_scraper_full.py';
const PYTHON_PATH = 'C:\\Chackravuham\\python\\python.exe';

interface StudentData {
  student?: { name?: string; roll_no?: string; program?: string; current_semester?: string };
  marks?: Record<string, Array<Record<string, string>>>;
  attendance?: Record<string, Array<Record<string, string>>>;
  _error?: string;
}

function loadStudentData(): StudentData | null {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const content = fs.readFileSync(CACHE_PATH, 'utf-8');
      return JSON.parse(content) as StudentData;
    }
  } catch (error) {
    console.error('Error loading AUMS student data cache:', error);
  }
  return null;
}

export class AumsTools {
  @ToolDecorator({
    name: 'connect_student_tool',
    description: 'Log into AUMS and scrape academic data in the background using a student\'s credentials (username and password)',
    inputSchema: z.object({
      username: z.string().describe('AUMS roll number / username'),
      password: z.string().describe('AUMS password')
    }),
    examples: {
      request: { username: "nc.ai.u4aid25055", password: "password123" },
      response: { result: "Success" }
    }
  })
  async connectStudent(input: { username: string; password: string }) {
    try {
      // Ensure the logs directory exists locally on the server
      const logsDir = path.dirname(LOG_FILE_PATH);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Check if we are running in a cloud environment where Playwright local script doesn't exist
      if (!fs.existsSync(SCRAPER_SCRIPT)) {
        return {
          result: "Background scraping is only supported when running the server locally on your PC (since the Python Playwright scraper relies on your local environment). However, you can still view your cached timetable, profile, and grades here!"
        };
      }

      const outStream = fs.openSync(LOG_FILE_PATH, 'a');

      const child = spawn(PYTHON_PATH, [SCRAPER_SCRIPT, input.username, input.password], {
        detached: true,
        shell: true,
        stdio: ['ignore', outStream, outStream]
      });
      child.unref();

      return {
        result: `Successfully triggered AUMS login for student ${input.username} in the background. Please wait 45 seconds for data scraping to complete, then try asking me for your profile, marks, or attendance.`
      };
    } catch (err: any) {
      return { result: `Unexpected error starting scraper background task: ${err.message}` };
    }
  }

  @ToolDecorator({
    name: 'timetable_tool',
    description: 'Retrieve the class schedule. Ask "what class is now" or specify a day to get the timetable list.',
    inputSchema: z.object({
      day: z.string().optional().describe('Filter by specific day (Monday, Tuesday, Wednesday, Thursday, Friday). Defaults to current day if not provided.'),
      nowOnly: z.boolean().optional().describe('Set to true to check the current active class running right now based on real system time.')
    }),
    examples: {
      request: { nowOnly: true },
      response: { result: "Calculated current class details" }
    }
  })
  async getTimetable(input: { day?: string; nowOnly?: boolean }) {
    try {
      if (!fs.existsSync(TIMETABLE_PATH)) {
        return { result: `Timetable database is not initialized.` };
      }
      const db = JSON.parse(fs.readFileSync(TIMETABLE_PATH, 'utf-8'));
      
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const date = new Date();
      
      let targetDay = input.day || days[date.getDay()];
      if (targetDay === "Sunday" || targetDay === "Saturday") {
        targetDay = "Monday";
      }

      const schedule = db.days[targetDay];
      if (!schedule) {
        return { result: `No scheduled classes found for ${targetDay}.` };
      }

      if (input.nowOnly) {
        const currentHour = date.getHours();
        const currentMin = date.getMinutes();
        const timeVal = currentHour * 60 + currentMin;

        let activeSlot: any = null;
        let nextSlot: any = null;

        for (const slotDef of db.slots) {
          const [sh, sm] = slotDef.start.split(':').map(Number);
          const [eh, em] = slotDef.end.split(':').map(Number);
          const startVal = sh * 60 + sm;
          const endVal = eh * 60 + em;

          if (timeVal >= startVal && timeVal <= endVal) {
            activeSlot = slotDef;
          } else if (timeVal < startVal && !nextSlot) {
            nextSlot = slotDef;
          }
        }

        if (!activeSlot) {
          let nextClassText = "No more classes today.";
          if (nextSlot) {
            const nextClass = schedule.find((c: any) => c.slot === nextSlot.name);
            if (nextClass) {
              nextClassText = `Next class is ${nextClass.code}: ${nextClass.name} in Room ${nextClass.room} at ${nextSlot.start} - ${nextSlot.end}.`;
            } else {
              nextClassText = `Next slot is ${nextSlot.name} (${nextSlot.start} - ${nextSlot.end}).`;
            }
          }
          return { result: `There is no active class running right now. ${nextClassText}` };
        }

        const activeClass = schedule.find((c: any) => c.slot === activeSlot.name);
        if (!activeClass) {
          return { result: `Current slot is ${activeSlot.name} (${activeSlot.start} - ${activeSlot.end}), which is a break/free slot.` };
        }

        return {
          result: `Current active class is ${activeClass.code}: ${activeClass.name} in Room ${activeClass.room} (Slot: ${activeClass.slot}, Time: ${activeSlot.start} - ${activeSlot.end}).`
        };
      }

      let responseText = `### Class Schedule for ${targetDay} (Room: E216)\n\n`;
      responseText += "| Time | Slot | Course Code | Course Name |\n|---|---|---|---|\n";
      for (const item of schedule) {
        const slotDef = db.slots.find((s: any) => s.name === item.slot);
        const timeRange = slotDef ? `${slotDef.start} - ${slotDef.end}` : '-';
        responseText += `| ${timeRange} | ${item.slot} | ${item.code} | ${item.name} |\n`;
      }
      return { result: responseText };
    } catch (err: any) {
      return { result: `Error reading timetable: ${err.message}` };
    }
  }

  @ToolDecorator({
    name: 'syllabus_tool',
    description: 'Retrieve course details, syllabus units, textbooks, and evaluation weights for a specific course code',
    inputSchema: z.object({
      courseCode: z.string().describe('The code of the course (e.g. 23MAT204, 23AID201, 23AID202, 23AID203, 23AID204, 23AID205, 23AID206)')
    }),
    examples: {
      request: { courseCode: "23MAT204" },
      response: { result: "Syllabus detailed data" }
    }
  })
  async getSyllabus(input: { courseCode: string }) {
    try {
      if (!fs.existsSync(SYLLABUS_PATH)) {
        return { result: `Syllabus database is not initialized.` };
      }
      const raw = fs.readFileSync(SYLLABUS_PATH, 'utf-8');
      const db = JSON.parse(raw);
      const courses = db.semesters["3"].courses;
      
      const course = courses.find((c: any) => c.code.toLowerCase() === input.courseCode.toLowerCase());
      if (!course) {
        return { result: `Course with code ${input.courseCode} not found in the Semester 3 database.` };
      }
      return { result: JSON.stringify(course, null, 2) };
    } catch (err: any) {
      return { result: `Failed to read syllabus database: ${err.message}` };
    }
  }

  @ToolDecorator({
    name: 'profile_tool',
    description: 'Retrieve the active student\'s academic profile (Name, Roll, Program, Semester)',
    inputSchema: z.object({}),
    examples: {
      request: {},
      response: { result: "Profile info here" }
    }
  })
  async getProfile() {
    const data = loadStudentData();
    if (!data || !data.student) {
      return { result: `No student profile data found. Please run connect_student_tool first to login and scrape AUMS data.` };
    }
    return { result: JSON.stringify(data.student, null, 2) };
  }

  @ToolDecorator({
    name: 'marks_tool',
    description: 'Retrieve internal evaluation marks and grades for all courses',
    inputSchema: z.object({}),
    examples: {
      request: {},
      response: { result: "Marks data here" }
    }
  })
  async getMarks() {
    const data = loadStudentData();
    if (!data || !data.marks) {
      return { result: `No marks data found. Please run connect_student_tool first to login and scrape AUMS data.` };
    }
    return { result: JSON.stringify(data.marks, null, 2) };
  }

  @ToolDecorator({
    name: 'attendance_tool',
    description: 'Retrieve course-wise attendance summary percentages',
    inputSchema: z.object({}),
    examples: {
      request: {},
      response: { result: "Attendance data here" }
    }
  })
  async getAttendance() {
    const data = loadStudentData();
    if (!data || !data.attendance) {
      return { result: `No attendance data found. Please run connect_student_tool first to login and scrape AUMS data.` };
    }
    return { result: JSON.stringify(data.attendance, null, 2) };
  }
}
