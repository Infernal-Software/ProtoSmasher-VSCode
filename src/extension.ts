import * as vscode from "vscode";

import WebSocketAsPromised = require("websocket-as-promised");
import Chalk = require("chalk");
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";

// contstants
const port: string			= "45859"
const baseUrl: string 		= `ws://localhost:${port}/`;
const timeout: number 		= 1000; // ms

// websocket init
let W3CWebSocket: any = require("websocket").w3cwebsocket;
let wsClient: WebSocketAsPromised = new WebSocketAsPromised(baseUrl, {
	createWebSocket: url => new W3CWebSocket(url, [], undefined, {
		'User-Agent': 'ProtoSmasher/External 1.0'
	})
});

let output: vscode.OutputChannel = vscode.window.createOutputChannel("ProtoSmasher");
let runItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
runItem.command = "extension.protosmasherExecute";
runItem.tooltip = "Execute ProtoSmasher Scripts";
runItem.text = "$(triangle-right) ProtoSmasher Execute";

// async things for websocket
async function sendEvent(websocket: WebSocketAsPromised, event: Number,value: any)
{
	await websocket.send(JSON.stringify({ Action: event, ...value }))
}


function spawnInjectorAndWait(injectorPath) 
{
	return new Promise((resolve, reject) => {
		if(!fs.existsSync(injectorPath))
			return reject("Injector path does not exist");

		let timeout = null;
		let injectorProcess = child_process.execFile(injectorPath, 
			(err, stdout, stdin) => {
				console.log("hm", err, stdout, stdin);
				if(!err && (typeof stdout === 'string' ||
					stdout.includes("Injected!")))
				{
					clearTimeout(timeout);

					if(!injectorProcess.killed) {
						injectorProcess.kill();
					}

					resolve();
				}
			});

		timeout = setTimeout(() => {
			console.log("timed out");
			if(!injectorProcess.killed) {
				injectorProcess.kill();
			}

			reject();
		}, 10 * 1000);
	});
}

// misc
function resetRunItem():void {
	debounce = false;
	runItem.text = "$(triangle-right) ProtoSmasher Execute";
	runItem.command = "extension.protosmasherExecute";
	runItem.show();
}

const ConvertToRGB = (color) => {
	let r = color & 255;
	let g = (color >> 8) & 255;
	let b = (color >> 16) & 255;
	return {r, g, b}
  };

// internal funcs
function onWebSocketMessage(data) {
	var json = JSON.parse(data);

	switch(json.Action)
	{
		case "2": // Clear Console
			output.clear();
			break;

		case "8": // Output
			let message = json.Message || "";

			if (json.NewLine === "true")
				message = message + "\n"; 

			// VS-Code OutputChannels do not support color yet, this is stupid
			// let rgb = ConvertToRGB(json.Color);
			// message = Chalk.default.rgb(rgb.r, rgb.g, rgb.b)(message);

			output.append(message);
			break;
		default:
			break;
	}
}

let debounce = false;
async function executeScript(didError: Boolean = false)
{
	var content: string = vscode.window.activeTextEditor.document.getText();
	if(content.trim() === "" || debounce) {
		return;
	}

	debounce = true;
	runItem.command = "";
	runItem.text = "Loading...";
	runItem.show();

	try {
		if(!wsClient.isOpened) {
			await wsClient.open();
			output.show();
		}

		await sendEvent(wsClient, 3, { 
			Value: content
		})

		vscode.window.showInformationMessage("Script Executed");
	} catch(e) {
		const err: string = (<Error>e).message;

		console.log(err);
		// make the failed to connect error a bit more simplistic
		if(err.includes("WebSocket") && err.includes("connection failed")) 
		{
			const injectorDirPath:string = vscode.workspace.getConfiguration().get('protosmasher.injector-dir');
			let injector = path.join(injectorDirPath, "ProtoSmasher.exe");
			if(didError || !fs.existsSync(injector)) {
				resetRunItem();
				return vscode.window.showErrorMessage("Error occured while executing", "Couldn't connect to ProtoSmasher!");
			} else {
				try {
					await spawnInjectorAndWait(injector);
					vscode.window.showInformationMessage("ProtoSmasher Injected", "ProtoSmasher has been injected into ROBLOX, please press execute again to run the script");
					resetRunItem();
					return;
				} catch {
					resetRunItem();
					return vscode.window.showErrorMessage("Error occured while executing", "Couldn't connect to ProtoSmasher!");
				}
			}
		}

		resetRunItem();
		return vscode.window.showErrorMessage("Error occured while executing", err);
	}

	resetRunItem();
}

// execution function
export function activate({ subscriptions }: vscode.ExtensionContext): void {
	console.log(`protosmasher execution plugin loaded!`);

	runItem.show();

	wsClient.onMessage.addListener(onWebSocketMessage);

	vscode.window.showInformationMessage("ProtoSmasher Script Executed");


	const config = vscode.workspace.getConfiguration()
	const injectorPath = config.get('protosmasher.injector-dir');
	if(typeof injectorPath === 'string' && injectorPath.trim() === '') {
		vscode.window.showWarningMessage("Auto-Inject is disabled, please define the injector path in the settings to enable this feature")
	} else if(!fs.existsSync(injectorPath as fs.PathLike)) {
		vscode.window.showErrorMessage("Auto-Inject is disabled, the injector path in settings is not a valid path")
	}

	let disposable: vscode.Disposable;
	disposable = vscode.commands.registerCommand("extension.protosmasherExecute", executeScript);

	subscriptions.push(disposable);
}


export function deactivate():void {
	console.log(`ProtoSmasher execution plugin shutting down...`);

	runItem.dispose();
	output.dispose();
	if(wsClient.isOpened) wsClient.close();
}
