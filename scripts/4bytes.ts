import hre from 'hardhat'
import fs from 'fs'
import fetch from "isomorphic-fetch"
import previousSync from "./4bytes-syncced.json"
/**
 * This script will sync any event and function we have with www.4byte.directory
 * The script saves all processed signatures with 4bytes-syncced.json as it succcesses
 * this way we avoid syncing the same signature twice.
 * */

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
	const artifacts = await hre.artifacts.getAllFullyQualifiedNames();
	const artifactsWithAbi = (await Promise.all(artifacts.map(name => hre.artifacts.readArtifact(name)))).filter(artifact => artifact.abi.length !== 0);
	const prevFunctions = new Set<string>(previousSync.functions)
	const prevEvents = new Set<string>(previousSync.events)
	const newErrorSignatures = new Set<string>()
	const newFunctionSignatures = new Set<string>()
	const newEventSignatures = new Set<string>()
	for (const { abi } of artifactsWithAbi) {
		const abiInterface = new hre.ethers.utils.Interface(abi)
		// Events and Errors seem to be the same thing for 4bytes
		Object.keys(abiInterface.events).filter(e => !prevEvents.has(e)).forEach(e => newEventSignatures.add(e))
		Object.keys(abiInterface.errors).filter(e => !prevEvents.has(e)).forEach(e => newEventSignatures.add(e))
		
		Object.keys(abiInterface.functions).filter(e => !prevFunctions.has(e)).forEach(e => newFunctionSignatures.add(e))
	}
	const total = newErrorSignatures.size + newFunctionSignatures.size + newEventSignatures.size
	if (total === 0) {
		console.log("All up to date!")
		return;
	}

	console.log("Will sync " + total + " signatures with 4bytes...")

	const save = () => {
		fs.writeFileSync("./scripts/4bytes-syncced.json", JSON.stringify(previousSync, null, 2));
	}
	console.log("----- Synccing functions ----- ")
	for (const sig of newFunctionSignatures) {
		for (let i = 0; i < 3; i++) {
			const resp = await fetch("https://www.4byte.directory/api/v1/signatures/", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					"text_signature": sig,
				})
			})
			if (resp.status === 400 || resp.status === 201) {
				console.log("function", sig, resp.status, await resp.text())
				previousSync.functions.push(sig);
				save()
				break
			}
			if (i === 2) {
				console.log("Failed to sync function", sig, "after 3 attempts")
			} else {
				await sleep(1000)
			}
		}

	}
	console.log("----- Synccing events ----- ")
	for (const sig of newEventSignatures) {
		for (let i = 0; i < 3; i++) {
			const resp = await fetch("https://www.4byte.directory/api/v1/event-signatures/", {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					"text_signature": sig,
				})
			})
			if (resp.status === 400 || resp.status === 201) {
				console.log("event", sig, resp.status, await resp.text())
				previousSync.events.push(sig);
				save()
				break
			}

			if (i === 2) {
				console.log("Failed to sync event", sig, "after 3 attempts")
			} else {
				await sleep(1000)
			}
		}
	}
	console.log("Done!")
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
