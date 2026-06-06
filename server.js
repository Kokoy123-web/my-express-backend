const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")
const bodyParser = require("body-parser")
const http = require("http")
const { Server } = require("socket.io")

const app = express();
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};
app.use(cors(corsOptions));
app.use(bodyParser.json());
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

const emitDataChanged = (resource, action, payload = {}) => {
  io.emit("dataChanged", {
    resource,
    action,
    at: new Date().toISOString(),
    ...payload,
  });
};

const requireFields = (fields = []) => {
  for (const { value, name } of fields) {
    if (!value || value.toString().trim() === "") {
      return `${name} is required`;
    }
  }
  return null;
};

// Validation helper functions
const validateEmail = (email) => {

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePhone = (phone) => {
  const phoneRegex = /^\d{10,15}$/;
  return phoneRegex.test(phone);
};

const validateDate = (date) => {
  const dateObj = new Date(date);
  return !isNaN(dateObj.getTime());
};

const generateUniqueEmployeeCode = () => {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const code = Math.floor(10000 + Math.random() * 90000).toString();
      db.query("SELECT id FROM employees WHERE employee_code = ?", [code], (err, results) => {
        if (err) return reject(err);
        if (results.length === 0) {
          resolve(code);
        } else {
          attempt();
        }
      });
    };
    attempt();
  });
};


// ✨ BAG-ONG KONEKSYON GAMIT ANG POOL PARA SA RAILWAY PRODUCTION ONLINE
const db = mysql.createPool({
  host: process.env.MYSQLHOST || "localhost",
  user: process.env.MYSQLUSER || "root",     
  password: process.env.MYSQLPASSWORD || "",     
  database: process.env.MYSQLDATABASE || "employee_db",
  port: process.env.MYSQLPORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


// Detect whether positions table is named `positions` or `position`
let POSITIONS_TABLE = "positions";
const detectPositionsTable = () => {
  db.query("SHOW TABLES LIKE 'positions'", (err, results) => {
    if (err) {
      console.warn("Unable to detect positions table name:", err.message);
      return;
    }
    if (Array.isArray(results) && results.length > 0) {
      POSITIONS_TABLE = "positions";
      return;
    }
    db.query("SHOW TABLES LIKE 'position'", (err2, results2) => {
      if (err2) {
        console.warn("Unable to detect positions table name:", err2.message);
        return;
      }
      if (Array.isArray(results2) && results2.length > 0) {
        POSITIONS_TABLE = "position";
      }
    });
  });
};
detectPositionsTable();

// Routes
// ===== POSITIONS ROUTES =====

// Get all positions
app.get("/positions", (req, res) => {
  db.query(`SELECT id, position_name FROM ${POSITIONS_TABLE} ORDER BY position_name ASC`, (err, results) => {
    if (err) {
      console.error("Error fetching positions:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Get all employees (include department name via join)
app.get("/employees", (req, res) => {
  const query = `
    SELECT e.id,
           e.employee_code,
           e.name,
           e.position_id,
           p.position_name AS position,
           p.position_name AS position_name,
           e.email,
           e.phone,
           e.department_id,
           d.department_name AS department
    FROM employees e
    LEFT JOIN ${POSITIONS_TABLE} p ON e.position_id = p.id
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY e.id DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching employees:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Get single employee by id (with department name)
app.get("/employees/:id", (req, res) => {
  const query = `
    SELECT e.id,
           e.employee_code,
           e.name,
           e.position_id,
           p.position_name AS position,
           p.position_name AS position_name,
           e.email,
           e.phone,
           e.department_id,
           d.department_name AS department
    FROM employees e
    LEFT JOIN ${POSITIONS_TABLE} p ON e.position_id = p.id
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.id = ?
    LIMIT 1
  `;
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error("Error fetching employee:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json(results[0]);
  });
});

// Add employee
app.post("/employees", async (req, res) => {
  try {
    let { name, position_id, department_id, email, phone, password } = req.body;
    phone = phone || "";
    password = password || "";

    if (!name || !position_id || !department_id || !email || !password) {
      return res.status(400).json({ error: "Name, position, department, email and password are required" });
    }
    if (isNaN(parseInt(position_id, 10))) {
      return res.status(400).json({ error: "Invalid position selection" });
    }
    if (isNaN(parseInt(department_id, 10))) {
      return res.status(400).json({ error: "Invalid department selection" });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (password.trim().length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    const employee_code = await generateUniqueEmployeeCode();

    db.query(
      "INSERT INTO employees (employee_code, name, position_id, department_id, email, phone) VALUES (?, ?, ?, ?, ?, ?)",
      [employee_code, name, position_id, department_id, email, phone],
      (err, result) => {
        if (err) {
          console.error("Error adding employee:", err);
          return res.status(500).json({ error: "Database error: " + err.message });
        }

        const employeeId = result.insertId;
        db.query(
          "INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, 'employee', ?)",
          [email, password, employeeId],
          (userErr) => {
            if (userErr) {
              console.error("Error adding user for employee:", userErr);
              db.query("DELETE FROM employees WHERE id = ?", [employeeId], (deleteErr) => {
                if (deleteErr) {
                  console.error("Error rolling back employee after user creation failure:", deleteErr);
                }
                const statusCode = userErr.code === 'ER_DUP_ENTRY' ? 400 : 500;
                return res.status(statusCode).json({ error: userErr.code === 'ER_DUP_ENTRY' ? "User with that email already exists" : "Database error: " + userErr.message });
              });
              return;
            }

            emitDataChanged("employees", "created", { employeeId });
            res.json({ id: employeeId, employee_code, name, position_id, department_id, email, phone, password });
          }
        );
      }
    );
  } catch (error) {
    console.error("Error generating employee code:", error);
    res.status(500).json({ error: "Error adding employee" });
  }
});

// Delete employee
app.delete("/employees/:id", (req, res) => {
  db.query("DELETE FROM employees WHERE id = ?", [req.params.id], (err, result) => {
    if (err) {
      console.error("Error deleting employee:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    emitDataChanged("employees", "deleted", { employeeId: Number(req.params.id) });
    res.json({ message: "Employee deleted" });
  });
});

// Update employee (full update by admin or partial update by employee)
app.put("/employees/:id", (req, res) => {
  let { name, position_id, department_id, email, phone } = req.body;
  phone = phone || "";
  
  // Check if this is a partial update (employee profile update) or full update (admin)
  // Employee profile update only requires name, email, phone
  const isPartialUpdate = !position_id && !department_id;
  
  if (isPartialUpdate) {
    // Employee profile update - only update name, email, phone, and optional password
    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }
    if (req.body.password && req.body.password.trim().length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }
    
    db.query(
      "UPDATE employees SET name=?, email=?, phone=? WHERE id=?",
      [name, email, phone, req.params.id],
      (err, result) => {
        if (err) {
          console.error("Error updating employee:", err);
          return res.status(500).json({ message: "Failed to update profile" });
        }
        const updateUserQuery = req.body.password
          ? "UPDATE users SET username = ?, password = ? WHERE employee_id = ?"
          : "UPDATE users SET username = ? WHERE employee_id = ?";
        const updateUserParams = req.body.password
          ? [email, req.body.password, req.params.id]
          : [email, req.params.id];
        db.query(
          updateUserQuery,
          updateUserParams,
          (userErr, userResult) => {
            if (userErr) {
              console.error("Error updating linked user credentials:", userErr);
              const statusCode = userErr.code === 'ER_DUP_ENTRY' ? 400 : 500;
              return res.status(statusCode).json({ message: userErr.code === 'ER_DUP_ENTRY' ? "Email already in use by another user" : "Failed to update profile user credentials" });
            }
            if (userResult.affectedRows === 0) {
              const insertParams = req.body.password
                ? [email, req.body.password, 'employee', req.params.id]
                : [email, '', 'employee', req.params.id];
              const insertQuery = "INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, ?, ?)";
              db.query(insertQuery, insertParams, (insertErr) => {
                if (insertErr) {
                  console.error("Error creating linked user credentials:", insertErr);
                  const statusCode = insertErr.code === 'ER_DUP_ENTRY' ? 400 : 500;
                  return res.status(statusCode).json({ message: insertErr.code === 'ER_DUP_ENTRY' ? "Email already in use by another user" : "Failed to create profile user credentials" });
                }
                emitDataChanged("employees", "updated", { employeeId: Number(req.params.id) });
                res.json({ message: "Profile updated successfully" });
              });
              return;
            }
            emitDataChanged("employees", "updated", { employeeId: Number(req.params.id) });
            res.json({ message: "Profile updated successfully" });
          }
        );
      }
    );
  } else {
    // Full update by admin - requires all fields
    if (!name || !position_id || !department_id || !email) {
      return res.status(400).json({ error: "Name, position, department and email are required" });
    }
    if (isNaN(parseInt(position_id, 10))) {
      return res.status(400).json({ error: "Invalid position selection" });
    }
    if (isNaN(parseInt(department_id, 10))) {
      return res.status(400).json({ error: "Invalid department selection" });
    }

    db.query(
      "UPDATE employees SET name=?, position_id=?, department_id=?, email=?, phone=? WHERE id=?",
      [name, position_id, department_id, email, phone, req.params.id],
      (err, result) => {
        if (err) {
          console.error("Error updating employee:", err);
          return res.status(500).json({ error: "Database error: " + err.message });
        }
        const updateUserQuery = req.body.password
          ? "UPDATE users SET username = ?, password = ? WHERE employee_id = ?"
          : "UPDATE users SET username = ? WHERE employee_id = ?";
        const updateUserParams = req.body.password
          ? [email, req.body.password, req.params.id]
          : [email, req.params.id];

        db.query(
          updateUserQuery,
          updateUserParams,
          (userErr, userResult) => {
            if (userErr) {
              console.error("Error updating linked user credentials:", userErr);
              const statusCode = userErr.code === 'ER_DUP_ENTRY' ? 400 : 500;
              return res.status(statusCode).json({ error: userErr.code === 'ER_DUP_ENTRY' ? "Email already in use by another user" : "Database error: " + userErr.message });
            }
            if (userResult.affectedRows === 0) {
              const insertParams = req.body.password
                ? [email, req.body.password, 'employee', req.params.id]
                : [email, '', 'employee', req.params.id];
              const insertQuery = "INSERT INTO users (username, password, role, employee_id) VALUES (?, ?, ?, ?)";
              db.query(insertQuery, insertParams, (insertErr) => {
                if (insertErr) {
                  console.error("Error creating linked user credentials:", insertErr);
                  const statusCode = insertErr.code === 'ER_DUP_ENTRY' ? 400 : 500;
                  return res.status(statusCode).json({ error: insertErr.code === 'ER_DUP_ENTRY' ? "Email already in use by another user" : "Database error: " + insertErr.message });
                }
                emitDataChanged("employees", "updated", { employeeId: Number(req.params.id) });
                res.json({ message: "Employee updated" });
              });
              return;
            }
            emitDataChanged("employees", "updated", { employeeId: Number(req.params.id) });
            res.json({ message: "Employee updated" });
          }
        );
      }
    );
  }
});

  // = DEPARTMENTS ROUTES ====

// Get all departments
app.get("/departments", (req, res) => {
  db.query("SELECT * FROM departments", (err, results) => {
    if (err) {
      console.error("Error fetching departments:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Add department
app.post("/departments", (req, res) => {
  const { department_name, description } = req.body;

  const validationError = requireFields([
    { value: department_name, name: "Department name" },
    { value: description, name: "Description" }
  ]);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  db.query(
    "INSERT INTO departments (department_name, description) VALUES (?, ?)",
    [department_name.trim(), description.trim()],
    (err, result) => {
      if (err) {
        console.error("Error adding department:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      emitDataChanged("departments", "created", { departmentId: result.insertId });
      res.json({ id: result.insertId, department_name, description });
    }
  );
});

// Update department
app.put("/departments/:id", (req, res) => {
  const { department_name, description } = req.body;

  const validationError = requireFields([
    { value: department_name, name: "Department name" },
    { value: description, name: "Description" }
  ]);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  db.query(
    "UPDATE departments SET department_name=?, description=? WHERE id=?",
    [department_name.trim(), description.trim(), req.params.id],
    (err, result) => {
      if (err) {
        console.error("Error updating department:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      emitDataChanged("departments", "updated", { departmentId: Number(req.params.id) });
      res.json({ message: "Department updated" });
    }
  );
});

// Delete department
app.delete("/departments/:id", (req, res) => {
  db.query("DELETE FROM departments WHERE id=?", [req.params.id], (err, result) => {
    if (err) {
      console.error("Error deleting department:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    emitDataChanged("departments", "deleted", { departmentId: Number(req.params.id) });
    res.json({ message: "Department deleted" });
  });
});


// ===== ATTENDANCE ROUTES =====

// Get all attendance records with employee info
app.get("/attendance", (req, res) => {
  const query = `
    SELECT a.id,
           a.employee_id,
           e.name AS employee_name,
           e.employee_code,
           a.date,
           a.time_in,
           a.time_out,
           a.status
    FROM attendance a
    LEFT JOIN employees e ON a.employee_id = e.id
    ORDER BY a.date DESC, a.time_in DESC, a.id DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching attendance records:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Get attendance records for a single employee
app.get("/attendance/employee/:employee_id", (req, res) => {
  const employeeId = parseInt(req.params.employee_id, 10);
  if (isNaN(employeeId)) {
    return res.status(400).json({ error: "Invalid employee ID" });
  }

  const query = `
    SELECT a.id,
           a.employee_id,
           e.name AS employee_name,
           e.employee_code,
           a.date,
           a.time_in,
           a.time_out,
           a.status
    FROM attendance a
    LEFT JOIN employees e ON a.employee_id = e.id
    WHERE a.employee_id = ?
    ORDER BY a.date DESC, a.time_in DESC, a.id DESC
  `;

  db.query(query, [employeeId], (err, results) => {
    if (err) {
      console.error("Error fetching employee attendance:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Add attendance record (admin form)
app.post("/attendance", (req, res) => {
  let { employee_id, date, time_in, time_out, status } = req.body;
  if (!employee_id || !date || !time_in || !status) {
    return res.status(400).json({ error: "employee_id, date, time_in, and status are required" });
  }

  employee_id = parseInt(employee_id, 10);
  if (isNaN(employee_id)) {
    return res.status(400).json({ error: "Invalid employee ID" });
  }

  const query = "INSERT INTO attendance (employee_id, date, time_in, time_out, status) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [employee_id, date, time_in, time_out || null, status], (err, result) => {
    if (err) {
      console.error("Error inserting attendance record:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    emitDataChanged("attendance", "created", { attendanceId: result.insertId, employeeId: employee_id });
    res.json({ id: result.insertId, employee_id, date, time_in, time_out, status });
  });
});


// Delete attendance record
app.delete("/attendance/:id", (req, res) => {
  const attendanceId = req.params.id;
  db.query("DELETE FROM attendance WHERE id = ?", [attendanceId], (err, result) => {
    if (err) {
      console.error("Error deleting attendance record:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Attendance record not found" });
    }
    emitDataChanged("attendance", "deleted", { attendanceId: Number(attendanceId) });
    res.json({ message: "Attendance record deleted" });
  });
});

// ===== PAYSLIP ROUTES =====

// Get all payslips with employee name
app.get("/payslips", (req, res) => {
  console.log("GET /payslips called");
  const query = `
    SELECT p.*, e.name, e.employee_code AS employee_code
    FROM payslips p
    LEFT JOIN employees e ON p.employee_id = e.id
    ORDER BY p.pay_period DESC, p.id DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching payslips:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Add payslip
app.post("/payslips", (req, res) => {
  console.log("POST /payslips", req.body);
  let { employee_id, pay_period, gross_amount, deductions = 0, net_amount } = req.body;
  // basic validation
  if (!employee_id || !pay_period || gross_amount === undefined || net_amount === undefined) {
    return res.status(400).json({ error: "Required fields missing" });
  }
  employee_id = parseInt(employee_id, 10);
  gross_amount = parseFloat(gross_amount);
  deductions = parseFloat(deductions) || 0;
  net_amount = parseFloat(net_amount);
  if (isNaN(employee_id)) {
    return res.status(400).json({ error: "Invalid employee selection" });
  }
  if (isNaN(gross_amount) || isNaN(net_amount)) {
    return res.status(400).json({ error: "Amount values must be numbers" });
  }

  db.query(
    "INSERT INTO payslips (employee_id,pay_period,gross_amount,deductions,net_amount) VALUES (?,?,?,?,?)",
    [employee_id, pay_period, gross_amount, deductions, net_amount],
    (err, result) => {
      if (err) {
        console.error("Error adding payslip:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      emitDataChanged("payslips", "created", {
        payslipId: result.insertId,
        employeeId: Number(employee_id),
      });
      res.json({ id: result.insertId, employee_id, pay_period, gross_amount, deductions, net_amount });
    }
  );
});

// Get payslips for single employee
app.get("/payslips/employee/:employee_id", (req, res) => {
  const query = `
    SELECT p.*
    FROM payslips p
    WHERE p.employee_id = ?
    ORDER BY p.pay_period DESC
  `;
  db.query(query, [req.params.employee_id], (err, results) => {
    if (err) {
      console.error("Error fetching employee payslips:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Delete payslip
app.delete("/payslips/:id", (req, res) => {
  console.log("DELETE /payslips/", req.params.id);

  const sql = "DELETE FROM payslips WHERE id = ?";

  db.query(sql, [req.params.id], (err, result) => {
    if (err) {
      console.error("Error deleting payslip:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Payslip not found" });
    }

    emitDataChanged("payslips", "deleted", { payslipId: Number(req.params.id) });
    res.json({ message: "Payslip deleted successfully" });
  });
});

// Update payslip
app.put("/payslips/:id", (req, res) => {
  console.log("PUT /payslips/", req.params.id, req.body);
  let { pay_period, gross_amount, deductions = 0, net_amount } = req.body;
  if (!pay_period || gross_amount === undefined || net_amount === undefined) {
    return res.status(400).json({ error: "Required fields missing" });
  }
  gross_amount = parseFloat(gross_amount);
  deductions = parseFloat(deductions) || 0;
  net_amount = parseFloat(net_amount);
  if (isNaN(gross_amount) || isNaN(net_amount)) {
    return res.status(400).json({ error: "Amount values must be numbers" });
  }
  const sql = "UPDATE payslips SET pay_period=?, gross_amount=?, deductions=?, net_amount=? WHERE id=?";
  const fields = [pay_period, gross_amount, deductions, net_amount, req.params.id];

  db.query(sql, fields, (err, result) => {
    if (err) {
      console.error("Error updating payslip:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    emitDataChanged("payslips", "updated", { payslipId: Number(req.params.id) });
    res.json({ message: "Payslip updated" });
  });
});



app.post("/api/attendance", (req, res) => {
   
    const employee_code_input = req.body.employee_id; 
    const log_type = req.body.log_type;
    
    const now = new Date();
    const today = now.toLocaleDateString('en-CA'); // Format: YYYY-MM-DD
    const currentTime = now.toTimeString().split(' ')[0]; // Format: HH:mm:ss

    // 1. Mangita sa 'employees' table gamit ang 'employee_code'
    db.query("SELECT id, name FROM employees WHERE employee_code = ?", [employee_code_input], (err, empResults) => {
        if (err) return res.status(500).send("Database Error.");
        
        // Check kung naay employee nga naay ingana nga code
        if (empResults.length === 0) {
            return res.status(404).send(`Error: Ang Code (${employee_code_input}) wala sa records.`);
        }

        // MAO NI ANG SAKTONG ID (Primary Key) UG NAME
        const realEmployeeID = empResults[0].id; 
        const employeeName = empResults[0].name;

        // 2. I-check ang attendance record karong adlawa gamit ang realEmployeeID
        db.query("SELECT * FROM attendance WHERE employee_id = ? AND date = ?", [realEmployeeID, today], (err, records) => {
            if (err) return res.status(500).send("Database Error checking attendance.");

            if (log_type === "In") {
                if (records.length > 0) {
                    return res.status(400).send(`Hi ${employeeName}, naka-Time In na ka karon.`);
                }

                // 8:30 AM Threshold
                const isLate = now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() >= 30);
                const status = isLate ? "Late" : "Present";

                // I-save sa attendance table (Ang realEmployeeID ang i-insert sa employee_id column)
                db.query("INSERT INTO attendance (employee_id, date, time_in, status) VALUES (?, ?, ?, ?)", 
                [realEmployeeID, today, currentTime, status], (err, result) => {
                    if (err) return res.status(500).send("Failed to save Time In.");
                    
                    if (typeof emitDataChanged === "function") {
                        emitDataChanged("attendance", "created", { attendanceId: result.insertId, employeeId: realEmployeeID });
                    }
                    return res.status(200).send(`SUCCESS TIME IN!\n\nName: ${employeeName}\nTime: ${currentTime}\nStatus: ${status}`);
                });

            } else if (log_type === "Out") {
                if (records.length === 0) {
                    return res.status(400).send(`Hi ${employeeName}, kinahanglan mo Time In una.`);
                }
                
                const record = records[0];
                if (record.time_out) {
                    return res.status(400).send(`Hi ${employeeName}, naka-Time Out na ka karon.`);
                }

                db.query("UPDATE attendance SET time_out = ? WHERE id = ?", [currentTime, record.id], (err) => {
                    if (err) return res.status(500).send("Failed to save Time Out.");
                    
                    if (typeof emitDataChanged === "function") {
                        emitDataChanged("attendance", "updated", { attendanceId: record.id, employeeId: realEmployeeID });
                    }
                    return res.status(200).send(`SUCCESS TIME OUT!\n\nName: ${employeeName}\nTime: ${currentTime}\nSalamat!`);
                });
            }
        });
    });
});


// ===== AUTHENTICATION ROUTES =====

// Login endpoint
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  db.query(
    "SELECT * FROM users WHERE username = ? AND password = ?",
    [username, password],
    (err, results) => {
      if (err) {
        console.error("Error during login:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      
      if (results.length === 0) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const user = results[0];

      // if user is an employee, ensure the linked employee record exists
      if (user.role === "employee") {
        if (!user.employee_id) {
          return res.status(401).json({ error: "Employee account not linked to any employee record." });
        }
        db.query("SELECT id FROM employees WHERE id = ?", [user.employee_id], (err2, empRes) => {
          if (err2) {
            console.error("Error checking employee:", err2);
            return res.status(500).json({ error: "Database error: " + err2.message });
          }
          if (empRes.length === 0) {
            return res.status(401).json({ error: "No matching employee record found for this user." });
          }
          // login success
          return res.json({
            success: true,
            user: {
              id: user.id,
              username: user.username,
              role: user.role
            },
            employeeId: user.employee_id
          });
        });
      } else {
        // non-employee user (e.g. admin)
        return res.json({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        });
      }
    }
  );
});

// Get all users (for display in login form)
app.get("/users", (req, res) => {
  db.query("SELECT id, username, role, employee_id, created_at FROM users ORDER BY created_at DESC", (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// ===== LEAVE REQUEST ROUTES =====

// Get all leave requests with employee information (for admin)
app.get("/api/leaves", (req, res) => {
  const query = `
    SELECT l.id, l.employee_id, l.leave_type, l.start_date, l.end_date, l.reason, l.status, l.created_at, l.approved_by,
           e.name AS employee_name, e.employee_code, e.email,
           CASE
             WHEN l.status IN ('Approved', 'Rejected') THEN COALESCE(e2.name, 'Admin')
             ELSE NULL
           END AS approved_by_name
    FROM leaves l
    LEFT JOIN employees e ON l.employee_id = e.id
    LEFT JOIN users u ON l.approved_by = u.id
    LEFT JOIN employees e2 ON u.employee_id = e2.id
    ORDER BY l.created_at DESC
  `;
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching leaves:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});

// Submit leave request (employee)
app.post("/api/leaves", (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  const validationError = requireFields([
    { value: employee_id, name: "Employee ID" },
    { value: leave_type, name: "Leave type" },
    { value: start_date, name: "Start date" },
    { value: end_date, name: "End date" }
  ]);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // Validate dates
  if (!validateDate(start_date) || !validateDate(end_date)) {
    return res.status(400).json({ error: "Invalid date format" });
  }

  if (new Date(start_date) > new Date(end_date)) {
    return res.status(400).json({ error: "Start date cannot be after end date" });
  }

  db.query(
    "INSERT INTO leaves (employee_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)",
    [employee_id, leave_type, start_date, end_date, reason || null],
    (err, result) => {
      if (err) {
        console.error("Error submitting leave request:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      emitDataChanged("leaves", "created", { leaveId: result.insertId, employeeId: employee_id });
      res.json({ id: result.insertId, message: "Leave request submitted successfully" });
    }
  );
});

// Approve or reject leave request (admin)
app.put("/api/leaves/:id", (req, res) => {
  const { status, approved_by } = req.body;
  const leaveId = req.params.id;

  if (!status || !['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: "Valid status (Approved/Rejected) is required" });
  }

  if (!approved_by) {
    return res.status(400).json({ error: "Approved by user ID is required" });
  }

  db.query(
    "UPDATE leaves SET status = ?, approved_by = ? WHERE id = ?",
    [status, approved_by, leaveId],
    (err, result) => {
      if (err) {
        console.error("Error updating leave status:", err);
        return res.status(500).json({ error: "Database error: " + err.message });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Leave request not found" });
      }
      emitDataChanged("leaves", "updated", { leaveId: Number(leaveId) });
      res.json({ message: `Leave request ${status.toLowerCase()} successfully` });
    }
  );
});

// Get leave requests for specific employee
app.get("/api/leaves/employee/:employee_id", (req, res) => {
  const query = `
    SELECT l.*, 
           CASE
             WHEN l.status IN ('Approved', 'Rejected') THEN COALESCE(e.name, 'Admin')
             ELSE NULL
           END AS approved_by_name
    FROM leaves l
    LEFT JOIN users u ON l.approved_by = u.id
    LEFT JOIN employees e ON u.employee_id = e.id
    WHERE l.employee_id = ?
    ORDER BY l.created_at DESC
  `;
  db.query(query, [req.params.employee_id], (err, results) => {
    if (err) {
      console.error("Error fetching employee leaves:", err);
      return res.status(500).json({ error: "Database error: " + err.message });
    }
    res.json(results);
  });
});



const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}`);
});
