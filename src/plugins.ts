import * as fs from 'fs'
import { Message, Guild, User, Collection, GuildMember } from 'discord.js'
import { Command, RunArguments } from './lib/command'
import { Client } from './client'
import Config from './Config'

/**
	* PluginSystem:
	* 	The master Class of Plugins. It's responsible for managing everything
	* 	related to plugins (commands) loading them and providing extra functionalities.
*/
export class PluginSystem {

	/** A collection (extends Map) to store and manage commands.*/
	private _commands: Collection<string, Command>

	/* 
		* Manage commands cooldown
		* 	Types: CommandName: string -> Map<userid: string, timestamp: number>
	*/
	private _cooldowns: Collection<string, Map<string, number>>

	constructor() {
		this._commands = new Collection<string, Command>()
		this._cooldowns = new Collection<string, Map<string, number>>()
	}

	get commands(): Collection<string, Command> {
		return this._commands
	}

	get groups(): string[] {
		return [...new Set(this._commands.map((cmd: Command) => cmd.config.group ? cmd.config.group : 'basic'))] as string[]
	}

	getCommand(name: string): Command | null {
		return this._commands.find((cmd: Command) => cmd.config.name == name) || this._commands.find((cmd: Command) => cmd.config.alias?.includes(name)) || null;
	}

	loadCommands() {
		fs.readdirSync('src/commands')
		.map(folder => {
			fs.readdirSync(`src/commands/${folder}`)
			.forEach(file => {
				if (file.endsWith('.ts')) {
					const C = require(`./commands/${folder}/${file.slice(0, -3)}`);
					this.loadCommand(this.checkCommandConfig(new C()))
				}
			})
		})
	}

	loadCommand<Cmd extends Command>(cmd: Cmd) {
		if (!cmd || !cmd.config && !cmd.run) return;

		this._commands.set(cmd.config.name, cmd)
		console.log(`-> Command '${cmd.config.name}' loaded`)

		// If the command have a cooldown create It in the collection
		if (cmd.config.cooldown && !this._cooldowns.has(cmd.config.name)) {
			this._cooldowns.set(cmd.config.name, new Map<string, number>())
			console.log(`--> '${cmd.config.name}' cooldown created`)
		}
	}

	async emitCommand(params: RunArguments) {
		const { message, user } = params;
		let command: Command | null = this.getCommand(params.cmd)
		if (!command) return;

		if (command.config.ownerOnly && message.author.id !== Config.owner) {
			message.channel.send('Sólo el propietario del Bot puede utilizar este comando.')
			return;
		}

		if (command.config.guildOnly && message.channel.type === 'dm') {
			message.channel.send('Este comando sólo está disponible en servidores de discord.')
			return;
		}

		// If the bot doesn't have the permissions, it returns an error message.
		if (command.config.permissions != 'SEND_MESSAGES' && message.channel.type == 'text') {
			const bot: GuildMember | null = (params.guild as Guild).members.cache.find(member => member.user.bot && member.id == Client.user!.id) || null;
			if (bot && !bot.hasPermission(command.config.permissions)) {
				message.channel.send(`No puedo ejecutar ese comando. Me falta el permiso de \`${command.config.permissions}\``)
				return;
			}
		}

		// Cooldown verification
		if (command.config.cooldown && command.config.cooldown > 0 && this._cooldowns.has(command.config.name)) {
			const cooldown = this._cooldowns.get(command.config.name) as Map<string, number>

			// If the user has previously used the command return an error message
			if (cooldown.has(user.id)) {
				const expiration: number = (command.config.cooldown * 1000) + (cooldown.get(user.id) as number)

				if (Date.now() < expiration) {
					message.channel.send(`¡No tan rápido ${user}!`)
					message.channel.send(`Debes esperar **${command.config.cooldown} segundos** antes de poder volver a usar el comando \`${command.config.name}\``)
					return;
				}
			}

			// Clear cooldown after a while
			await Client.setTimeout(() => cooldown.delete(user.id), command.config.cooldown * 1000)
			// Set the user timestamp
			await cooldown.set(user.id, Date.now())
		}

		command.run(params)
	}

	/**
		* checkCommmandConfig:
		* 	Check the unassigned properties of config: CommandConfig
		* 	and give them a default value.
	*/
	private checkCommandConfig<Cmd extends Command>(cmd: Cmd): Cmd {
		if (cmd && cmd.config) {
			if (!cmd.config.desc) cmd.config.desc = ""
			if (!cmd.config.alias) cmd.config.alias = []
			if (!cmd.config.group) cmd.config.group = "utils"
			if (!cmd.config.usage) cmd.config.usage = ""
			if (!cmd.config.ownerOnly) cmd.config.ownerOnly = false
			if (!cmd.config.guildOnly) cmd.config.guildOnly = false
			if (!cmd.config.permissions) cmd.config.permissions = 'SEND_MESSAGES'
			if (!cmd.config.cooldown) cmd.config.cooldown = 0

			return cmd
		}

		return cmd
	}
}

/**
	* MessageHandler
	* 	Eval messages and provide responses.
*/
class MessageHandler {
	private plugins: PluginSystem;

	constructor(plugins: PluginSystem) {
		this.plugins = plugins
	}

	eval(message: Message) {
		if (message.author.bot) return;

		if (message.content.toLowerCase().trim().startsWith(Config.prefix)) {
			const params = this.getRunArguments(message)
			this.plugins.emitCommand(params)
		}
	}

	private getRunArguments(message: Message): RunArguments {
		const user: User = message.author;
        const guild: Guild | null = (message.guild) ? message.guild : null;
        const targets: string[] = message.content.slice(Config.prefix.length).trim().split(' ');
        const cmd: string = targets?.shift()?.toLowerCase() || "";
        const client = Client;

        return {message, client, user, guild, targets, cmd}
	}
}

export const Plugins = new PluginSystem()
export const MessageManager = new MessageHandler(Plugins)