import { _decorator, Component, Node, Sprite, Label, SpriteFrame, Vec2, Vec3, Color, EventTouch, EventMouse, Input, input, tween, Tween } from 'cc';

const { ccclass } = _decorator;

type Cell = {
    tile: Node;
    icon: Node;
    sprite: Sprite;
    row: number;
    col: number;
    position: Vec3;
    iconPosition: Vec3;
    baseScale: Vec3;
    iconScale: Vec3;
    baseColor: Color;
};

@ccclass('GameFlowController')
export class GameFlowController extends Component {
    private menu: Node | null = null;
    private game: Node | null = null;
    private cells: Cell[] = [];
    private board: Cell[][] = [];
    private spriteFrames: SpriteFrame[] = [];
    private selected: Cell | null = null;
    private pointerCell: Cell | null = null;
    private pointerStart: Vec2 | null = null;
    private pointerLast: Vec2 | null = null;
    private pointerOrigin: Vec3 | null = null;
    private pointerMode: 'touch' | 'mouse' | null = null;
    private ignoreMouseUntil = 0;
    private processing = false;
    private gameOver = false;
    private score = 0;
    private levelScore = 0;
    private moves = 0;
    private level = 1;
    private remainingTime = 60;
    private comboMultiplier = 1;
    private promptTimer = 0;
    private readonly promptDelay = 3.5;
    private hintCells: Cell[] = [];
    private scoreLabel: Label | null = null;
    private timeLabel: Label | null = null;
    private goalLabel: Label | null = null;
    private levelLabel: Label | null = null;
    private statusLabel: Label | null = null;
    private timeBar: Node | null = null;
    private readonly timerTick = () => this.onTimerTick();

    onEnable() {
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    onDisable() {
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        this.clearPointer();
        this.clearSelection();
        this.clearHints();
    }

    onLoad() {
        this.menu = this.node.getChildByName('Menu Screen');
        this.game = this.node.getChildByName('Game Screen');
        if (!this.menu || !this.game) return;

        this.menu.getChildByName('Play Button')?.on(Node.EventType.TOUCH_END, this.startFromMenu, this);
        this.menu.getChildByName('Level Button')?.on(Node.EventType.TOUCH_END, this.startFromMenu, this);
        this.game.getChildByName('Back Button')?.on(Node.EventType.TOUCH_END, this.returnToMenu, this);
        this.game.getChildByName('Restart Button')?.on(Node.EventType.TOUCH_END, this.startRound, this);

        this.scoreLabel = this.findLabel(this.game, 'Score Value');
        this.timeLabel = this.findLabel(this.game, 'Time Value');
        this.goalLabel = this.findLabel(this.game, 'Goal Value');
        this.levelLabel = this.findLabel(this.game, 'Level Text');
        this.statusLabel = this.findLabel(this.game, 'Status Value');
        this.timeBar = this.game.getChildByName('Bottom HUD')?.getChildByName('Time Remaining') ?? null;

        for (const name of ['Match Board', 'Score Panel', 'Level Panel', 'Goal Panel', 'Bottom HUD', 'Back Button', 'Restart Button', 'Status Value']) {
            const node = this.game.getChildByName(name);
            if (node) node.active = true;
        }
        const oldHint = this.game.getChildByName('Level Hint');
        if (oldHint) oldHint.active = false;

        // The existing scene supplies the board art and 36 touch targets.
        // Keep their authored size and positions; only manage their gameplay state.
        for (let row = 0; row < 6; row++) {
            this.board[row] = [];
            for (let col = 0; col < 6; col++) {
                const tile = this.game.getChildByName(`Tile ${row + 1}-${col + 1}`);
                const icon = tile?.getChildByName('Icon');
                const sprite = icon?.getComponent(Sprite);
                if (!tile || !icon || !sprite) continue;

                const cell: Cell = {
                    tile,
                    icon,
                    sprite,
                    row,
                    col,
                    position: tile.position.clone(),
                    iconPosition: icon.position.clone(),
                    baseScale: tile.scale.clone(),
                    iconScale: icon.scale.clone(),
                    baseColor: sprite.color.clone()
                };
                this.cells.push(cell);
                this.board[row][col] = cell;
                const frame = sprite.spriteFrame;
                if (frame && !this.spriteFrames.includes(frame)) this.spriteFrames.push(frame);

                tile.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.onCellTouchStart(cell, event), this);
                tile.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => this.onCellMouseDown(cell, event), this);
            }
        }
    }

    start() {
        if (this.menu) this.menu.active = true;
        if (this.game) this.game.active = false;
    }

    update(dt: number) {
        if (!this.game?.active || this.gameOver || this.processing) {
            this.promptTimer = 0;
            return;
        }
        this.promptTimer += dt;
        if (this.promptTimer >= this.promptDelay) {
            this.promptTimer = 0;
            this.showMoveHint();
        }
    }

    private findLabel(parent: Node, name: string): Label | null {
        for (const child of parent.children) {
            if (child.name === name) return child.getComponent(Label);
            const nested = this.findLabel(child, name);
            if (nested) return nested;
        }
        return null;
    }

    private startFromMenu() {
        if (!this.menu || !this.game) return;
        this.menu.active = false;
        this.game.active = true;
        this.startRound();
    }

    private returnToMenu() {
        this.unschedule(this.timerTick);
        this.clearSelection();
        this.clearHints();
        this.clearPointer();
        if (this.game) this.game.active = false;
        if (this.menu) this.menu.active = true;
    }

    private startRound() {
        this.unschedule(this.timerTick);
        this.clearSelection();
        this.clearHints();
        this.clearPointer();
        this.processing = false;
        this.gameOver = false;
        this.score = 0;
        this.levelScore = 0;
        this.moves = 0;
        this.remainingTime = 60;
        this.comboMultiplier = 1;
        this.promptTimer = 0;

        for (const cell of this.cells) {
            Tween.stopAllByTarget(cell.tile);
            Tween.stopAllByTarget(cell.icon);
            Tween.stopAllByTarget(cell.sprite);
            cell.tile.setPosition(cell.position);
            cell.tile.setScale(cell.baseScale);
            cell.icon.setPosition(cell.iconPosition);
            cell.icon.setScale(cell.iconScale);
            cell.sprite.color = cell.baseColor.clone();
        }

        this.createPlayableBoard();
        this.updateUI();
        this.setStatus('Kéo một ô sang ô liền kề hoặc chạm lần lượt hai ô.');
        this.schedule(this.timerTick, 1);
    }

    private createPlayableBoard() {
        for (let attempt = 0; attempt < 100; attempt++) {
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    const cell = this.board[row][col];
                    let frame = this.randomFrame();
                    let tries = 0;
                    while (tries++ < 20 && this.wouldCreateStartingRun(row, col, frame)) frame = this.randomFrame();
                    cell.sprite.spriteFrame = frame;
                }
            }
            if (this.findAllMatches().length === 0 && this.findAllPossibleMoves().length > 0) return;
        }
        this.shuffleBoard();
    }

    private wouldCreateStartingRun(row: number, col: number, frame: SpriteFrame) {
        const same = (r: number, c: number) => this.board[r][c]?.sprite.spriteFrame === frame;
        return (col >= 2 && same(row, col - 1) && same(row, col - 2))
            || (row >= 2 && same(row - 1, col) && same(row - 2, col));
    }

    private onCellTouchStart(cell: Cell, event: EventTouch) {
        if (this.gameOver || this.processing || this.remainingTime <= 0) return;
        if (this.pointerMode === 'mouse') this.clearPointer();
        this.ignoreMouseUntil = Date.now() + 800;
        this.beginPointer(cell, event.getUILocation(), 'touch');
    }

    private onCellMouseDown(cell: Cell, event: EventMouse) {
        if (Date.now() < this.ignoreMouseUntil || this.pointerMode === 'touch'
            || this.gameOver || this.processing || this.remainingTime <= 0
            || event.getButton() !== EventMouse.BUTTON_LEFT) return;
        this.beginPointer(cell, event.getUILocation(), 'mouse');
    }

    private beginPointer(cell: Cell, point: Vec2, mode: 'touch' | 'mouse') {
        this.resetPromptTimer();
        this.pointerCell = cell;
        this.pointerStart = point.clone();
        this.pointerLast = point.clone();
        this.pointerOrigin = cell.icon.position.clone();
        this.pointerMode = mode;
    }

    private onTouchMove(event: EventTouch) {
        if (this.pointerMode !== 'touch') return;
        this.movePointer(event.getUILocation());
    }

    private onMouseMove(event: EventMouse) {
        if (this.pointerMode !== 'mouse') return;
        this.movePointer(event.getUILocation());
    }

    private onTouchEnd(event: EventTouch) {
        this.ignoreMouseUntil = Date.now() + 800;
        if (this.pointerMode !== 'touch') return;
        this.endPointer(event.getUILocation());
    }

    private onTouchCancel(event: EventTouch) {
        if (this.pointerMode !== 'touch') return;
        this.ignoreMouseUntil = Date.now() + 800;
        this.endPointer(event.getUILocation());
    }

    private onMouseUp(event: EventMouse) {
        if (Date.now() < this.ignoreMouseUntil || this.pointerMode !== 'mouse') return;
        this.endPointer(event.getUILocation());
    }

    private movePointer(point: Vec2) {
        const cell = this.pointerCell;
        const start = this.pointerStart;
        const origin = this.pointerOrigin;
        if (!cell || !start || !origin) return;
        this.pointerLast = point.clone();
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        if (Math.hypot(dx, dy) < 8) return;
        this.clearSelection();
        cell.icon.setPosition(origin.x + dx, origin.y + dy, origin.z);
    }

    private endPointer(point: Vec2) {
        const cell = this.pointerCell;
        const start = this.pointerStart;
        if (!cell || !start) {
            this.clearPointer();
            return;
        }
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        this.clearPointer();
        if (this.gameOver || this.processing || this.remainingTime <= 0) return;

        const distance = Math.hypot(dx, dy);
        if (distance < 20) {
            this.onCellClicked(cell);
            return;
        }
        const direction = this.getSwipeDirection(dx, dy);
        if (direction) this.onCellSwiped(cell, direction);
    }

    private clearPointer() {
        if (this.pointerCell && this.pointerOrigin) this.pointerCell.icon.setPosition(this.pointerOrigin);
        this.pointerCell = null;
        this.pointerStart = null;
        this.pointerLast = null;
        this.pointerOrigin = null;
        this.pointerMode = null;
    }

    private getSwipeDirection(dx: number, dy: number): 'up' | 'down' | 'left' | 'right' | null {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const total = absX + absY;
        if (total === 0 || Math.abs(absX / total - absY / total) < 0.2) return null;
        if (absX > absY) return dx > 0 ? 'right' : 'left';
        return dy > 0 ? 'up' : 'down';
    }

    private onCellClicked(cell: Cell) {
        if (this.gameOver || this.processing || this.remainingTime <= 0) return;
        this.resetPromptTimer();
        if (!this.selected) {
            this.setSelected(cell, true);
            this.selected = cell;
            return;
        }
        if (this.selected === cell) {
            this.setSelected(cell, false);
            this.selected = null;
            return;
        }
        const first = this.selected;
        if (this.areAdjacent(first, cell)) {
            this.clearSelection();
            this.trySwap(first, cell);
        } else {
            this.clearSelection();
            this.selected = cell;
            this.setSelected(cell, true);
        }
    }

    private onCellSwiped(cell: Cell, direction: 'up' | 'down' | 'left' | 'right') {
        if (this.gameOver || this.processing || this.remainingTime <= 0) return;
        this.resetPromptTimer();
        this.clearSelection();
        const delta: Record<typeof direction, [number, number]> = {
            up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1]
        };
        const [dr, dc] = delta[direction];
        const adjacent = this.board[cell.row + dr]?.[cell.col + dc];
        if (adjacent) this.trySwap(cell, adjacent);
    }

    private areAdjacent(a: Cell, b: Cell) {
        return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
    }

    private setSelected(cell: Cell, selected: boolean) {
        Tween.stopAllByTarget(cell.tile);
        if (selected) {
            cell.sprite.color = new Color(255, 255, 210, 255);
            tween(cell.tile).to(0.16, { scale: new Vec3(cell.baseScale.x * 1.12, cell.baseScale.y * 1.12, cell.baseScale.z) })
                .to(0.16, { scale: new Vec3(cell.baseScale.x * 1.04, cell.baseScale.y * 1.04, cell.baseScale.z) })
                .union().repeatForever().start();
        } else {
            cell.tile.setScale(cell.baseScale);
            cell.sprite.color = cell.baseColor.clone();
        }
    }

    private clearSelection() {
        if (this.selected) this.setSelected(this.selected, false);
        this.selected = null;
    }

    private resetPromptTimer() {
        this.promptTimer = 0;
        this.clearHints();
    }

    private clearHints() {
        for (const cell of this.hintCells) {
            Tween.stopAllByTarget(cell.tile);
            cell.tile.setScale(cell.baseScale);
        }
        this.hintCells = [];
    }

    private showMoveHint() {
        if (this.processing || this.gameOver) return;
        const moves = this.findAllPossibleMoves();
        if (moves.length === 0) {
            this.shuffleBoard();
            return;
        }
        const [a, b] = moves[Math.floor(Math.random() * moves.length)];
        this.hintCells = [a, b];
        for (const cell of this.hintCells) {
            tween(cell.tile)
                .to(0.25, { scale: new Vec3(cell.baseScale.x * 1.12, cell.baseScale.y * 1.12, cell.baseScale.z) })
                .to(0.25, { scale: cell.baseScale })
                .union().repeatForever().start();
        }
    }

    private async trySwap(first: Cell, second: Cell) {
        if (this.processing || this.gameOver || !this.areAdjacent(first, second)) return;
        this.processing = true;
        this.comboMultiplier = 1;
        this.resetPromptTimer();
        try {
            await this.animateSwap(first, second);
            await this.delay(50);
            const matches = this.mergeMatches(this.findMatchesAt(first.row, first.col), this.findMatchesAt(second.row, second.col));
            if (matches.length < 3) {
                await this.animateSwap(first, second);
                this.setStatus('Nước đi này chưa ghép được ba biểu tượng.');
                return;
            }
            this.moves++;
            await this.resolveMatches(matches);
            if (this.findAllPossibleMoves().length === 0) this.shuffleBoard();
            this.updateUI();
            this.setStatus('Ghép thành công!');
        } finally {
            this.processing = false;
        }
    }

    private async animateSwap(a: Cell, b: Cell) {
        const frameA = a.sprite.spriteFrame;
        await Promise.all([a, b].map((cell) => new Promise<void>((resolve) => {
            Tween.stopAllByTarget(cell.tile);
            tween(cell.tile)
                .to(0.08, { scale: new Vec3(cell.baseScale.x * 0.84, cell.baseScale.y * 0.84, cell.baseScale.z) })
                .call(resolve).start();
        })));
        a.sprite.spriteFrame = b.sprite.spriteFrame;
        b.sprite.spriteFrame = frameA;
        await Promise.all([a, b].map((cell) => new Promise<void>((resolve) => {
            tween(cell.tile).to(0.12, { scale: cell.baseScale }, { easing: 'backOut' }).call(resolve).start();
        })));
    }

    private mergeMatches(a: Cell[], b: Cell[]) {
        const result = [...a];
        for (const cell of b) if (!result.includes(cell)) result.push(cell);
        return result;
    }

    private findMatchesAt(row: number, col: number): Cell[] {
        const cell = this.board[row]?.[col];
        if (!cell?.sprite.spriteFrame) return [];
        const frame = cell.sprite.spriteFrame;
        const horizontal = [cell];
        const vertical = [cell];
        for (let c = col - 1; c >= 0 && this.board[row][c].sprite.spriteFrame === frame; c--) horizontal.unshift(this.board[row][c]);
        for (let c = col + 1; c < 6 && this.board[row][c].sprite.spriteFrame === frame; c++) horizontal.push(this.board[row][c]);
        for (let r = row - 1; r >= 0 && this.board[r][col].sprite.spriteFrame === frame; r--) vertical.unshift(this.board[r][col]);
        for (let r = row + 1; r < 6 && this.board[r][col].sprite.spriteFrame === frame; r++) vertical.push(this.board[r][col]);
        const matches: Cell[] = [];
        if (horizontal.length >= 3) matches.push(...horizontal);
        if (vertical.length >= 3) for (const item of vertical) if (!matches.includes(item)) matches.push(item);
        return matches;
    }

    private findAllMatches() {
        const matches: Cell[] = [];
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                for (const cell of this.findMatchesAt(row, col)) if (!matches.includes(cell)) matches.push(cell);
            }
        }
        return matches;
    }

    private findAllPossibleMoves(): Array<[Cell, Cell]> {
        const possible: Array<[Cell, Cell]> = [];
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 6; col++) {
                const cell = this.board[row][col];
                for (const other of [this.board[row][col + 1], this.board[row + 1]?.[col]]) {
                    if (!other) continue;
                    const frameA = cell.sprite.spriteFrame;
                    const frameB = other.sprite.spriteFrame;
                    cell.sprite.spriteFrame = frameB;
                    other.sprite.spriteFrame = frameA;
                    const valid = this.findMatchesAt(cell.row, cell.col).length >= 3
                        || this.findMatchesAt(other.row, other.col).length >= 3;
                    cell.sprite.spriteFrame = frameA;
                    other.sprite.spriteFrame = frameB;
                    if (valid) possible.push([cell, other]);
                }
            }
        }
        return possible;
    }

    private async resolveMatches(firstMatches: Cell[]) {
        let matches = firstMatches;
        let combo = 1;
        for (let chain = 0; chain < 20 && matches.length > 0; chain++) {
            await this.blinkMatches(matches);
            const points = matches.length * 100 * combo;
            this.score += points;
            this.levelScore += points;
            if (matches.length >= 4) this.remainingTime += 2;
            this.updateUI();
            await this.clearAndRefill(matches);
            matches = this.findAllMatches();
            if (matches.length > 0) combo++;
        }
    }

    private async blinkMatches(matches: Cell[]) {
        await Promise.all(matches.map((cell) => new Promise<void>((resolve) => {
            tween(cell.sprite)
                .to(0.12, { color: new Color(255, 255, 255, 100) })
                .to(0.12, { color: cell.baseColor })
                .union().repeat(2)
                .call(() => resolve()).start();
        })));
    }

    private async clearAndRefill(matches: Cell[]) {
        const matched = new Set(matches);
        const popPromises = matches.map((cell) => new Promise<void>((resolve) => {
            Tween.stopAllByTarget(cell.tile);
            tween(cell.tile).to(0.16, { scale: new Vec3(0, 0, cell.baseScale.z) }, { easing: 'backIn' })
                .call(resolve).start();
        }));
        await Promise.all(popPromises);

        const drops: Promise<void>[] = [];
        const stepY = this.board[0][0].position.y - this.board[1][0].position.y;
        for (let col = 0; col < 6; col++) {
            const remaining: Array<{ frame: SpriteFrame; sourceRow: number }> = [];
            for (let row = 5; row >= 0; row--) {
                const cell = this.board[row][col];
                if (matched.has(cell)) continue;
                const frame = cell.sprite.spriteFrame;
                if (frame) remaining.push({ frame, sourceRow: row });
            }

            const spawnCount = 6 - remaining.length;
            let survivor = 0;
            for (let row = 5; row >= 0; row--) {
                const cell = this.board[row][col];
                const saved = remaining[survivor];
                const target = cell.iconPosition.clone();
                cell.sprite.spriteFrame = saved?.frame ?? this.randomFrame();
                cell.tile.setScale(cell.baseScale);
                cell.icon.setScale(cell.iconScale);
                cell.sprite.color = cell.baseColor.clone();
                if (saved) {
                    survivor++;
                    const rowsFallen = row - saved.sourceRow;
                    if (rowsFallen > 0) {
                        cell.icon.setPosition(target.x, target.y + stepY * rowsFallen, target.z);
                        drops.push(this.animateDrop(cell, target));
                    } else cell.icon.setPosition(target);
                } else {
                    const distance = spawnCount - row;
                    cell.icon.setPosition(target.x, target.y + stepY * distance, target.z);
                    drops.push(this.animateDrop(cell, target));
                }
            }
        }
        await Promise.all(drops);
    }

    private animateDrop(cell: Cell, target: Vec3) {
        return new Promise<void>((resolve) => {
            tween(cell.icon).to(0.24, { position: target }, { easing: 'cubicOut' }).call(resolve).start();
        });
    }

    private showMoveHint() {
        const moves = this.findAllPossibleMoves();
        if (moves.length === 0) {
            this.shuffleBoard();
            return;
        }
        const [a, b] = moves[Math.floor(Math.random() * moves.length)];
        this.hintCells = [a, b];
        for (const cell of this.hintCells) {
            tween(cell.tile)
                .to(0.25, { scale: new Vec3(cell.baseScale.x * 1.15, cell.baseScale.y * 1.15, cell.baseScale.z) })
                .to(0.25, { scale: cell.baseScale })
                .union().repeatForever().start();
        }
    }

    private shuffleBoard() {
        if (!this.spriteFrames.length) return;
        const frames = this.cells.map((cell) => cell.sprite.spriteFrame).filter((frame): frame is SpriteFrame => !!frame);
        for (let i = frames.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [frames[i], frames[j]] = [frames[j], frames[i]];
        }
        for (let index = 0; index < this.cells.length; index++) this.cells[index].sprite.spriteFrame = frames[index] ?? this.randomFrame();
        if (this.findAllMatches().length > 0 || this.findAllPossibleMoves().length === 0) this.createPlayableBoard();
        this.setStatus('Bàn chơi đã được xáo lại.');
    }

    private randomFrame() {
        return this.spriteFrames[Math.floor(Math.random() * this.spriteFrames.length)];
    }

    private onTimerTick() {
        if (this.gameOver || !this.game?.active) return;
        this.remainingTime = Math.max(0, this.remainingTime - 1);
        this.updateUI();
        if (this.remainingTime === 0) {
            this.gameOver = true;
            this.unschedule(this.timerTick);
            this.clearSelection();
            this.clearHints();
            this.setStatus(`Hết giờ! Điểm màn này: ${this.levelScore}`);
        }
    }

    private updateUI() {
        if (this.scoreLabel) this.scoreLabel.string = String(this.score).padStart(4, '0');
        if (this.timeLabel) {
            const minutes = Math.floor(this.remainingTime / 60);
            const seconds = this.remainingTime % 60;
            this.timeLabel.string = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            this.timeLabel.color = this.remainingTime <= 10 ? new Color(255, 70, 70, 255) : new Color(255, 255, 255, 255);
        }
        if (this.goalLabel) this.goalLabel.string = String(Math.max(0, 500 - this.levelScore));
        if (this.levelLabel) this.levelLabel.string = `MÀN ${String(this.level).padStart(2, '0')}`;
        if (this.timeBar) {
            const ratio = Math.max(0, this.remainingTime / 60);
            this.timeBar.setScale(ratio, this.timeBar.scale.y, this.timeBar.scale.z);
        }
    }

    private setStatus(message: string) {
        if (this.statusLabel) this.statusLabel.string = message;
    }

    private delay(ms: number) {
        return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }
}
