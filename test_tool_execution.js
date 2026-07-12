import 'reflect-metadata';
import { AumsTools } from './dist/modules/aums/aums.tools.js';

async function test() {
  const tools = new AumsTools();
  console.log('Testing connectStudent method...');
  try {
    const result = await tools.connectStudent({
      username: 'nc.ai.u4aid25055',
      password: 'wrong_password_test'
    });
    console.log('Result:', result);
  } catch (error) {
    console.error('Execution failed with error:', error);
  }
}

test();
