/**
 * cli.js — Terminal interface.
 *
 * A simple menu-driven CLI for creating/joining groups, adding expenses,
 * viewing balances, and seeing who's currently connected on the network.
 *
 * This file only calls into expenses.js (business logic) — it doesn't
 * know anything about sync internals beyond asking for the current peer list.
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const expenses = require('./expenses');
const { toTerminal } = require('./qrcode');
const { getLocalIPs } = require('./cert');

async function mainMenu(ctx) {
  // ctx = { deviceId, deviceName, hlcClock, discovery, sync, webServer }
  let running = true;

  while (running) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Splitwise P2P — what would you like to do?',
        choices: [
          { name: 'Show Web App URL & Wi-Fi QR Code (for phones)', value: 'show_qr' },
          { name: 'Create a new group', value: 'create_group' },
          { name: 'Join an existing group', value: 'join_group' },
          { name: 'View my groups', value: 'list_groups' },
          { name: 'Add an expense', value: 'add_expense' },
          { name: 'View balances', value: 'balances' },
          { name: 'View expense history', value: 'history' },
          { name: 'View connected peers', value: 'peers' },
          { name: 'Connect to peer by IP (manual)', value: 'connect_manual' },
          new inquirer.Separator(),
          { name: 'Exit (keep syncing in background — Ctrl+C to fully quit)', value: 'exit' },
        ],
      },
    ]);

    switch (action) {
      case 'show_qr':
        showQrFlow(ctx);
        break;
      case 'create_group':
        await createGroupFlow(ctx);
        break;
      case 'join_group':
        await joinGroupFlow(ctx);
        break;
      case 'list_groups':
        listGroupsFlow(ctx);
        break;
      case 'add_expense':
        await addExpenseFlow(ctx);
        break;
      case 'balances':
        await balancesFlow(ctx);
        break;
      case 'history':
        await historyFlow(ctx);
        break;
      case 'peers':
        peersFlow(ctx);
        break;
      case 'connect_manual':
        await connectManualFlow(ctx);
        break;
      case 'exit':
        running = false;
        console.log(chalk.gray('\nCLI closed. Sync is still running in the background.\n'));
        break;
    }
  }
}

function showQrFlow(ctx) {
  const ips = getLocalIPs();
  const primaryIp = ips[0] || '127.0.0.1';
  const httpsUrl = `https://${primaryIp}:8443`;
  const httpUrl = `http://${primaryIp}:8080`;
  const caUrl = `http://${primaryIp}:8080/ca.crt`;

  console.log(chalk.bold('\n======================================================'));
  console.log(chalk.bold.green('       Splitwise P2P — Local Web App & PWA'));
  console.log(chalk.bold('======================================================'));
  console.log(`  ${chalk.cyan('HTTPS App URL')}  : ${chalk.bold.underline(httpsUrl)}`);
  console.log(`  ${chalk.cyan('HTTP Helper')}    : ${chalk.underline(httpUrl)}`);
  console.log(`  ${chalk.cyan('Root CA Cert')}   : ${chalk.underline(caUrl)}`);
  console.log(chalk.gray('\n  Scan with your phone camera to open on Wi-Fi:'));
  console.log(toTerminal(httpsUrl));
  console.log(chalk.bold('======================================================\n'));
}

async function createGroupFlow(ctx) {
  const { groupName, yourName } = await inquirer.prompt([
    { type: 'input', name: 'groupName', message: 'Group name:' },
    { type: 'input', name: 'yourName', message: 'Your display name:' },
  ]);

  const group = expenses.createGroup(groupName, ctx.deviceId, yourName);
  console.log(chalk.green(`\nGroup "${group.name}" created!`));
  console.log(chalk.gray(`Group ID (share this with others to join): ${group.id}\n`));
}

async function joinGroupFlow(ctx) {
  const { groupId, yourName } = await inquirer.prompt([
    { type: 'input', name: 'groupId', message: 'Group ID (get this from someone already in the group):' },
    { type: 'input', name: 'yourName', message: 'Your display name:' },
  ]);

  expenses.joinGroupStub(groupId.trim(), ctx.deviceId, yourName);
  console.log(chalk.green('\nJoined! Waiting to sync with a peer on the network who has this group...'));
  console.log(chalk.gray('Tip: check "View connected peers" — once one is connected, data syncs automatically.\n'));
}

function listGroupsFlow(ctx) {
  const groups = expenses.listGroups();
  if (groups.length === 0) {
    console.log(chalk.yellow('\nNo groups yet. Create one first.\n'));
    return;
  }

  console.log('');
  for (const g of groups) {
    const members = expenses.listMembers(g.id);
    console.log(chalk.bold(g.name), chalk.gray(`(${g.id})`));
    console.log(chalk.gray(`  Members: ${members.map((m) => m.name).join(', ')}`));
  }
  console.log('');
}

async function pickGroup(message = 'Select a group:') {
  const groups = expenses.listGroups();
  if (groups.length === 0) {
    console.log(chalk.yellow('\nNo groups yet. Create one first.\n'));
    return null;
  }

  const { groupId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'groupId',
      message,
      choices: groups.map((g) => ({ name: g.name, value: g.id })),
    },
  ]);

  return groupId;
}

async function addExpenseFlow(ctx) {
  const groupId = await pickGroup();
  if (!groupId) return;

  const members = expenses.listMembers(groupId);
  if (members.length === 0) {
    console.log(chalk.yellow('\nThis group has no members yet.\n'));
    return;
  }

  const { description, amount, paidBy, splitBetween } = await inquirer.prompt([
    { type: 'input', name: 'description', message: 'What was this expense for?' },
    {
      type: 'input',
      name: 'amount',
      message: 'Amount:',
      validate: (v) => (!isNaN(parseFloat(v)) && parseFloat(v) > 0) || 'Enter a valid positive number',
    },
    {
      type: 'list',
      name: 'paidBy',
      message: 'Who paid?',
      choices: members.map((m) => ({ name: m.name, value: m.id })),
    },
    {
      type: 'checkbox',
      name: 'splitBetween',
      message: 'Split between whom?',
      choices: members.map((m) => ({ name: m.name, value: m.id })),
      validate: (v) => v.length > 0 || 'Select at least one person',
    },
  ]);

  const exp = expenses.addExpense(ctx.hlcClock, {
    groupId,
    description,
    amount: parseFloat(amount),
    paidBy,
    splitBetween,
    deviceId: ctx.deviceId,
  });

  console.log(chalk.green(`\nExpense added: "${exp.description}" — ${exp.amount}\n`));
}

async function balancesFlow(ctx) {
  const groupId = await pickGroup();
  if (!groupId) return;

  const members = expenses.listMembers(groupId);
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const balances = expenses.computeBalances(groupId);
  const settlements = expenses.simplifyDebts(groupId);

  console.log(chalk.bold('\nBalances:'));
  for (const [memberId, amount] of Object.entries(balances)) {
    const name = memberNames[memberId] || memberId;
    if (amount > 0.01) {
      console.log(`  ${chalk.green(name)} is owed ${chalk.green(amount.toFixed(2))}`);
    } else if (amount < -0.01) {
      console.log(`  ${chalk.red(name)} owes ${chalk.red(Math.abs(amount).toFixed(2))}`);
    } else {
      console.log(`  ${name} is settled up`);
    }
  }

  console.log(chalk.bold('\nSuggested settlements:'));
  if (settlements.length === 0) {
    console.log(chalk.gray('  Everyone is settled up!'));
  } else {
    for (const s of settlements) {
      const fromName = memberNames[s.from] || s.from;
      const toName = memberNames[s.to] || s.to;
      console.log(`  ${chalk.cyan(fromName)} pays ${chalk.cyan(toName)}: ${s.amount.toFixed(2)}`);
    }
  }
  console.log('');
}

async function historyFlow(ctx) {
  const groupId = await pickGroup();
  if (!groupId) return;

  const members = expenses.listMembers(groupId);
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const list = expenses.listExpenses(groupId);

  if (list.length === 0) {
    console.log(chalk.yellow('\nNo expenses yet in this group.\n'));
    return;
  }

  console.log('');
  for (const e of list) {
    const payerName = memberNames[e.paid_by] || e.paid_by;
    const splitNames = e.split_between.map((id) => memberNames[id] || id).join(', ');
    console.log(`  ${chalk.bold(e.description)} — ${e.amount} (paid by ${payerName})`);
    console.log(chalk.gray(`    split between: ${splitNames}`));
  }
  console.log('');
}

async function connectManualFlow(ctx) {
  const { host, port } = await inquirer.prompt([
    { type: 'input', name: 'host', message: 'Peer IP address (e.g. 192.168.1.42):' },
    { type: 'input', name: 'port', message: 'Peer port:', default: '47811' },
  ]);

  ctx.sync.connectManual(host.trim(), parseInt(port, 10));
  console.log(chalk.gray('\nAttempting connection... watch for [sync] log lines above.\n'));
}

function peersFlow(ctx) {
  const peers = ctx.discovery.getPeers();
  console.log('');
  if (peers.length === 0) {
    console.log(chalk.yellow('No peers currently visible on the network.'));
  } else {
    console.log(chalk.bold('Peers on this network:'));
    for (const p of peers) {
      const connected = ctx.sync.connectedPeers.has(p.deviceId) ? chalk.green('connected') : chalk.gray('found');
      console.log(`  ${p.name} — ${p.host}:${p.port} (${connected})`);
    }
  }
  console.log('');
}

module.exports = { mainMenu };
