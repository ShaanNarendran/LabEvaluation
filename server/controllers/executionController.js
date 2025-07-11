const { executeCode } = require('../util/dockerRunner');
const { Question, Submission } = require('../models');
const axios = require('axios');

const EVALUATION_API_URL = 'http://localhost:5050/api/placeholder/update-performance';

/**
 * Handles the final submission of code.
 */
exports.runCode = async (req, res, next) => {
  const { language, code, questionId } = req.body;
  
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { _id: studentId, user_id: mainSystemStudentId } = req.user;

  try {
    // --- NEW: Check for an existing submission before proceeding ---
    const existingSubmission = await Submission.findOne({ 
        student: studentId, 
        question: questionId 
    });

    if (existingSubmission) {
        // If a submission exists, block the request and send an error.
        return res.status(403).json({ error: 'You have already submitted an answer for this question.' });
    }
    // --- End of new check ---


    // If no submission was found, the process continues as normal.
    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const { stdout, stderr } = await executeCode(language, code, question.testCases);

    const passed = !stderr && question.testCases.every((testCase, index) => {
      return stdout[index]?.trim() === testCase.expected.trim();
    });

    const marksToAward = passed ? question.marks : 0;

    const submission = new Submission({
      question: questionId,
      student: studentId,
      code: code,
      output: stderr || stdout.join('\n'),
      passed: passed,
      marksAwarded: marksToAward
    });
    await submission.save();

    try {
      console.log(`Sending evaluation update for student: ${mainSystemStudentId}...`);
      const evaluationPayload = {
        student: mainSystemStudentId,
        test: questionId,
        marksObtained: marksToAward,
        status: 'completed',
        evaluatedAt: submission.submittedAt
      };
      await axios.post(EVALUATION_API_URL, evaluationPayload);
      console.log('Evaluation update sent successfully to placeholder API.');
    } catch (apiError) {
      console.error('Failed to send evaluation update to placeholder API:', apiError.message);
    }
    
    res.json({ stdout, stderr, submission });

  } catch (error) {
    next(error);
  }
};

/**
 * Handles a test run of the code. 
 */
exports.runTestCases = async (req, res, next) => {
  const { language, code } = req.body; 

  try {
      const customTestCases = [{ input: '' }];

      const { stdout, stderr } = await executeCode(language, code, customTestCases);
      
      res.json({ stdout, stderr });

  } catch (error) {
      next(error);
  }
};
