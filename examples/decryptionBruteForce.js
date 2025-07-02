const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

if (isMainThread) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let inputFile = null;
    let outputFile = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i' && i + 1 < args.length) {
            inputFile = args[i + 1];
        } else if (args[i] === '-o' && i + 1 < args.length) {
            outputFile = args[i + 1];
        }
    }

    if (!inputFile) {
        console.error('Usage: node decryptionBruteForce.js -i <path_to_sensor_data_file> [-o <output_file>]');
        console.error('Example: node decryptionBruteForce.js -i sensor_data.json -o decrypted_output.json');
        process.exit(1);
    }

    // Check if file exists
    if (!fs.existsSync(inputFile)) {
        console.error(`Error: File '${inputFile}' does not exist.`);
        process.exit(1);
    }

    // Main thread - coordinate workers
    const decryptor = require('../src');

    // Load sensor data from specified file
    const sensorData = fs.readFileSync(inputFile, 'utf-8');

    // Brute force parameters
    const MAX_VALUE = 8888888;
    const NUM_WORKERS = os.cpus().length; // Use all CPU cores
    const CHUNK_SIZE = Math.ceil(MAX_VALUE / NUM_WORKERS);
    const PROGRESS_INTERVAL = 10000; // Show progress every 10,000 attempts

    console.log(`Starting concurrent brute force attack...`);
    console.log(`Input file: ${inputFile}`);
    if (outputFile) {
        console.log(`Output file: ${outputFile}`);
    }
    console.log(`Testing values from 1 to ${MAX_VALUE.toLocaleString()}`);
    console.log(`Using ${NUM_WORKERS} worker threads (${os.cpus().length} CPU cores detected)`);
    console.log(`Each worker will test approximately ${CHUNK_SIZE.toLocaleString()} values`);
    console.log(`Progress will be shown every ${PROGRESS_INTERVAL.toLocaleString()} attempts`);
    console.log('---');

    const startTime = Date.now();
    let found = false;
    let successfulValue = null;
    let successfulResult = null;
    let totalAttempts = 0;
    let completedWorkers = 0;

    // Track progress from all workers
    const progressTracker = {
        lastProgress: 0,
        lastUpdate: Date.now()
    };

    // Create workers
    const workers = [];
    for (let i = 0; i < NUM_WORKERS; i++) {
        const start = i * CHUNK_SIZE + 1;
        const end = Math.min((i + 1) * CHUNK_SIZE, MAX_VALUE);

        const worker = new Worker(__filename, {
            workerData: {
                start,
                end,
                sensorData,
                workerId: i
            }
        });

        worker.on('message', (message) => {
            if (message.type === 'progress') {
                totalAttempts += message.attempts;

                // Show progress periodically
                if (totalAttempts - progressTracker.lastProgress >= PROGRESS_INTERVAL) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const rate = totalAttempts / elapsed;
                    const eta = (MAX_VALUE - totalAttempts) / rate;

                    console.log(`Progress: ${totalAttempts.toLocaleString()}/${MAX_VALUE.toLocaleString()} (${(totalAttempts / MAX_VALUE * 100).toFixed(2)}%)`);
                    console.log(`  Elapsed: ${elapsed.toFixed(1)}s | Rate: ${rate.toFixed(0)} attempts/s | ETA: ${eta.toFixed(0)}s`);

                    progressTracker.lastProgress = totalAttempts;
                    progressTracker.lastUpdate = Date.now();
                }
            } else if (message.type === 'success') {
                if (!found) {
                    found = true;
                    successfulValue = message.value;
                    successfulResult = message.result;

                    // Terminate all workers
                    workers.forEach(w => w.terminate());

                    // Display success results
                    const totalTime = (Date.now() - startTime) / 1000;
                    console.log('\n' + '='.repeat(50));
                    console.log('🎉 DECRYPTION SUCCESSFUL! 🎉');
                    console.log(`Successful value: ${successfulValue.toLocaleString()}`);
                    console.log(`Total attempts: ${(totalAttempts + message.attempts).toLocaleString()}`);
                    console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
                    console.log(`Average rate: ${((totalAttempts + message.attempts) / totalTime).toFixed(0)} attempts/second`);

                    if (outputFile) {
                        try {
                            fs.writeFileSync(outputFile, successfulResult.data);
                            console.log(`\nResults saved to: ${outputFile}`);
                        } catch (writeError) {
                            console.error(`Error writing to output file: ${writeError.message}`);
                        }
                    }

                    console.log('\nDecrypted data:');
                    console.log(JSON.parse(successfulResult.data));
                }
            } else if (message.type === 'complete') {
                completedWorkers++;
                totalAttempts += message.attempts;

                if (completedWorkers === NUM_WORKERS && !found) {
                    // All workers completed without success
                    const totalTime = (Date.now() - startTime) / 1000;
                    console.log('\n' + '='.repeat(50));
                    console.log('❌ Brute force failed');
                    console.log(`Tested all values from 1 to ${MAX_VALUE.toLocaleString()}`);
                    console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
                    console.log(`Total attempts: ${totalAttempts.toLocaleString()}`);
                    console.log(`Average rate: ${(totalAttempts / totalTime).toFixed(0)} attempts/second`);
                    console.log('No successful decryption found.');
                }
            }
        });

        worker.on('error', (error) => {
            console.error(`Worker ${i} error:`, error);
        });

        workers.push(worker);
    }

} else {
    // Worker thread - perform brute force on assigned range
    const decryptor = require('../src');
    const { start, end, sensorData, workerId } = workerData;

    let attempts = 0;
    const PROGRESS_REPORT_INTERVAL = 1000; // Report progress every 1000 attempts

    for (let i = start; i <= end; i++) {
        attempts++;

        // Report progress periodically
        if (attempts % PROGRESS_REPORT_INTERVAL === 0) {
            parentPort.postMessage({
                type: 'progress',
                attempts: PROGRESS_REPORT_INTERVAL,
                workerId
            });
            attempts = 0; // Reset counter after reporting
        }

        try {
            // Attempt decryption with current value
            const result = decryptor.decrypt(sensorData, null, i);

            if (result.success) {
                parentPort.postMessage({
                    type: 'success',
                    value: i,
                    result: result,
                    attempts: attempts,
                    workerId
                });
                return; // Exit worker
            }
        } catch (error) {
            // Continue on error - some values might cause exceptions
        }
    }

    // Worker completed its range
    parentPort.postMessage({
        type: 'complete',
        attempts: attempts,
        workerId
    });
}
