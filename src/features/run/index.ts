import * as vscode from 'vscode';
import { canDebug, launchTargets, parseTarget, sameTarget, type RunTarget } from './core';

const SELECTED_KEY = 'stormParity.run.selected';
const CMD = 'stormParity.run';

interface TargetPick extends vscode.QuickPickItem {
  target?: RunTarget;
  action?: 'editLaunch' | 'editTasks';
}

const folderOf = (t: RunTarget): vscode.WorkspaceFolder | undefined =>
  t.folder ? vscode.workspace.workspaceFolders?.find((f) => f.uri.toString() === t.folder) : undefined;

const taskFolder = (task: vscode.Task): string | undefined =>
  typeof task.scope === 'object' && task.scope && 'uri' in task.scope ? task.scope.uri.toString() : undefined;

const taskTarget = (task: vscode.Task): RunTarget => ({ kind: 'task', name: task.name, source: task.source, folder: taskFolder(task) });

/** launch.json configurations and compounds of every folder, plus the workspace file's own. */
function launchConfigs(): RunTarget[] {
  const out: RunTarget[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const launch = vscode.workspace.getConfiguration('launch', folder.uri).inspect<unknown>('configurations');
    const compounds = vscode.workspace.getConfiguration('launch', folder.uri).inspect<unknown>('compounds');
    out.push(...launchTargets({ configurations: launch?.workspaceFolderValue, compounds: compounds?.workspaceFolderValue }, folder.uri.toString()));
  }
  if (vscode.workspace.workspaceFile) {
    const c = vscode.workspace.getConfiguration('launch');
    out.push(...launchTargets({ configurations: c.inspect('configurations')?.workspaceValue, compounds: c.inspect('compounds')?.workspaceValue }));
  }
  return out;
}

/**
 * PhpStorm's Run widget: a status bar selector of run configurations (launch.json, compounds and every task VS Code
 * knows: tasks.json, npm scripts, composer scripts, ...) with Run, Debug and Stop buttons next to it.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  let selected = parseTarget(ctx.workspaceState.get(SELECTED_KEY));
  const selector = vscode.window.createStatusBarItem(`${CMD}.selector`, vscode.StatusBarAlignment.Left, -100);
  const runButton = vscode.window.createStatusBarItem(`${CMD}.runButton`, vscode.StatusBarAlignment.Left, -101);
  const debugButton = vscode.window.createStatusBarItem(`${CMD}.debugButton`, vscode.StatusBarAlignment.Left, -102);
  const stopButton = vscode.window.createStatusBarItem(`${CMD}.stopButton`, vscode.StatusBarAlignment.Left, -103);
  for (const [item, name] of [
    [selector, 'Run Configuration'],
    [runButton, 'Run'],
    [debugButton, 'Debug'],
    [stopButton, 'Stop'],
  ] as const) {
    item.name = `Storm: ${name}`;
  }
  selector.command = `${CMD}.select`;
  runButton.command = `${CMD}.run`;
  runButton.text = '$(play)';
  debugButton.command = `${CMD}.debug`;
  debugButton.text = '$(debug-alt)';
  stopButton.command = `${CMD}.stop`;
  stopButton.text = '$(debug-stop)';

  const runningTasks = () => vscode.tasks.taskExecutions.filter((e) => selected && sameTarget(taskTarget(e.task), selected));
  const runningSessions = (): vscode.DebugSession[] => {
    const active = vscode.debug.activeDebugSession;
    return active ? [active] : [];
  };
  const isRunning = () => runningTasks().length > 0 || (selected?.kind !== 'task' && runningSessions().length > 0);

  const render = () => {
    const where = selected?.folder && (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? folderOf(selected)?.name : undefined;
    selector.text = selected ? `$(${selected.kind === 'task' ? 'tools' : 'debug'}) ${selected.name}` : '$(play) Run Configuration';
    selector.tooltip = selected
      ? `${selected.name}${selected.source ? ` (${selected.source})` : ''}${where ? ` in ${where}` : ''}. Click to choose another run configuration.`
      : 'Choose a run configuration (launch.json, tasks, npm and composer scripts)';
    runButton.tooltip = selected ? `Run '${selected.name}'` : 'Run...';
    debugButton.tooltip = selected ? `Debug '${selected.name}'` : 'Debug...';
    stopButton.tooltip = selected ? `Stop '${selected.name}'` : 'Stop';
    const running = isRunning();
    void vscode.commands.executeCommand('setContext', `${CMD}.running`, running);
    selector.show();
    runButton.show();
    if (!selected || canDebug(selected)) debugButton.show();
    else debugButton.hide();
    if (running) stopButton.show();
    else stopButton.hide();
  };

  const select = async (target: RunTarget) => {
    selected = target;
    await ctx.workspaceState.update(SELECTED_KEY, target);
    render();
  };

  const findTask = async (t: RunTarget): Promise<vscode.Task | undefined> =>
    (await vscode.tasks.fetchTasks()).find((task) => sameTarget(taskTarget(task), t));

  const launch = async (t: RunTarget, debug: boolean): Promise<void> => {
    if (t.kind === 'task') {
      const task = await findTask(t);
      if (!task) {
        void vscode.window.showWarningMessage(`Storm: task "${t.name}" no longer exists.`);
        return;
      }
      await vscode.tasks.executeTask(task);
      return;
    }
    const ok = await vscode.debug.startDebugging(folderOf(t), t.name, { noDebug: !debug });
    if (!ok) void vscode.window.showWarningMessage(`Storm: could not start "${t.name}". Check launch.json.`);
  };

  /** All run configurations, launch first, then tasks grouped by source (npm, composer, Workspace, ...). */
  const pickTarget = async (title: string, debugOnly = false): Promise<RunTarget | undefined> => {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const describe = (t: RunTarget) => [t.source, multiRoot && t.folder ? folderOf(t)?.name : undefined].filter(Boolean).join(' · ');
    const item = (t: RunTarget): TargetPick => ({
      label: `${sameTarget(t, selected) ? '$(check)' : t.kind === 'task' ? '$(tools)' : '$(debug)'} ${t.name}`,
      description: describe(t) || (t.kind === 'compound' ? 'compound' : undefined),
      target: t,
    });
    const qp = vscode.window.createQuickPick<TargetPick>();
    qp.title = title;
    qp.placeholder = 'Select a run configuration';
    qp.matchOnDescription = true;
    qp.busy = true;
    qp.show();
    const launches = launchConfigs();
    const tasks = debugOnly ? [] : (await vscode.tasks.fetchTasks()).map(taskTarget);
    const bySource = new Map<string, RunTarget[]>();
    for (const t of tasks) bySource.set(t.source ?? 'Tasks', [...(bySource.get(t.source ?? 'Tasks') ?? []), t]);
    qp.items = [
      ...(launches.length ? [{ label: 'launch.json', kind: vscode.QuickPickItemKind.Separator } as TargetPick, ...launches.map(item)] : []),
      ...[...bySource].flatMap(([source, list]) => [{ label: source, kind: vscode.QuickPickItemKind.Separator } as TargetPick, ...list.map(item)]),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(gear) Edit Configurations...', action: 'editLaunch', alwaysShow: true },
      ...(debugOnly ? [] : [{ label: '$(gear) Configure Tasks...', action: 'editTasks' as const, alwaysShow: true }]),
    ];
    const current = qp.items.find((i) => i.target && sameTarget(i.target, selected));
    if (current) qp.activeItems = [current];
    qp.busy = false;
    const picked = await new Promise<TargetPick | undefined>((resolve) => {
      qp.onDidAccept(() => resolve(qp.selectedItems[0]));
      qp.onDidHide(() => resolve(undefined));
    });
    qp.dispose();
    if (picked?.action === 'editLaunch') await vscode.commands.executeCommand('workbench.action.debug.configure');
    if (picked?.action === 'editTasks') await vscode.commands.executeCommand('workbench.action.tasks.configureTaskRunner');
    return picked?.target;
  };

  const runSelected = async (debug: boolean) => {
    let target = selected;
    if (!target || (debug && !canDebug(target))) {
      target = await pickTarget(debug ? 'Debug' : 'Run', debug);
      if (!target) return;
      await select(target);
    }
    await launch(target, debug);
  };

  const stop = async () => {
    for (const e of runningTasks()) e.terminate();
    if (selected?.kind !== 'task') for (const s of runningSessions()) await vscode.debug.stopDebugging(s);
  };

  ctx.subscriptions.push(
    selector,
    runButton,
    debugButton,
    stopButton,
    vscode.commands.registerCommand(`${CMD}.select`, async () => {
      const t = await pickTarget('Run Configuration');
      if (t) await select(t);
    }),
    vscode.commands.registerCommand(`${CMD}.run`, () => runSelected(false)),
    vscode.commands.registerCommand(`${CMD}.debug`, () => runSelected(true)),
    vscode.commands.registerCommand(`${CMD}.runAny`, async () => {
      const t = await pickTarget('Run');
      if (!t) return;
      await select(t);
      await launch(t, false);
    }),
    vscode.commands.registerCommand(`${CMD}.debugAny`, async () => {
      const t = await pickTarget('Debug', true);
      if (!t) return;
      await select(t);
      await launch(t, true);
    }),
    vscode.commands.registerCommand(`${CMD}.stop`, stop),
    vscode.tasks.onDidStartTask(render),
    vscode.tasks.onDidEndTask(render),
    vscode.debug.onDidStartDebugSession(render),
    vscode.debug.onDidTerminateDebugSession(render),
    vscode.debug.onDidChangeActiveDebugSession(render),
  );
  render();
}
