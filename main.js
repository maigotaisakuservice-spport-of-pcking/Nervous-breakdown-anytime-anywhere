// main.js

(() => {
  'use strict';

  // --- グローバル変数 ---
  const cardSymbols = ['🍎','🍌','🍇','🍒','🥝','🍍','🥥','🍉']; // 8種類ペア（16枚）
  let deck = [];
  let flippedCards = [];
  let matchedCards = new Set();
  let canFlip = true;
  let gameMode = null; // 'single', 'daily', 'bluetooth'
  let bluetoothDevice = null;
  let bluetoothServer = null;
  let bluetoothCharacteristic = null;
  let playerTurn = false; // bluetooth対戦用
  let playerName = "プレイヤー"; // 仮

  // --- DOM要素 ---
  const gameBoard = document.getElementById('gameBoard');
  const logArea = document.getElementById('logArea');
  const bluetoothStatus = document.getElementById('bluetoothStatus');
  const importFileInput = document.getElementById('importFile');

  // --- ログ出力 ---
  function log(msg){
    const now = new Date().toLocaleTimeString();
    logArea.textContent += `[${now}] ${msg}\n`;
    logArea.scrollTop = logArea.scrollHeight;
  }

  // --- カードシャッフル ---
  function shuffle(array){
    for(let i=array.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // --- デッキ生成（16枚 ペア8組） ---
  function createDeck(){
    const pairSymbols = cardSymbols.slice(0,8);
    const newDeck = [];
    pairSymbols.forEach(sym => {
      newDeck.push(sym);
      newDeck.push(sym);
    });
    shuffle(newDeck);
    return newDeck;
  }

  // --- ゲーム盤描画 ---
  function renderBoard(){
    gameBoard.innerHTML = '';
    deck.forEach((symbol, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      if(matchedCards.has(i)){
        card.classList.add('flipped');
      }
      card.dataset.index = i;

      const inner = document.createElement('div');
      inner.className = 'card-inner';

      const front = document.createElement('div');
      front.className = 'card-front';
      front.textContent = symbol;

      const back = document.createElement('div');
      back.className = 'card-back';
      back.textContent = '🂠';

      inner.appendChild(front);
      inner.appendChild(back);
      card.appendChild(inner);

      card.addEventListener('click', () => onCardClick(i));
      gameBoard.appendChild(card);
    });
  }

  // --- カードクリック処理 ---
  function onCardClick(index){
    if(!canFlip || flippedCards.includes(index) || matchedCards.has(index)) return;
    if(gameMode==='bluetooth' && !playerTurn){
      log("相手のターンです。待ってください。");
      return;
    }

    flipCard(index);
  }

  // --- カードを裏返す ---
  function flipCard(index){
    flippedCards.push(index);
    updateCardFlip(index,true);

    if(flippedCards.length === 2){
      canFlip = false;
      setTimeout(checkMatch, 1000);
    }
  }

  // --- 表示反映 ---
  function updateCardFlip(index, flipped){
    const card = gameBoard.querySelector(`.card[data-index="${index}"]`);
    if(card){
      if(flipped){
        card.classList.add('flipped');
      } else {
        card.classList.remove('flipped');
      }
    }
  }

  // --- ペア判定 ---
  function checkMatch(){
    const [a,b] = flippedCards;
    if(deck[a] === deck[b]){
      matchedCards.add(a);
      matchedCards.add(b);
      log(`ペアを見つけた！ ${deck[a]}`);
      if(gameMode==='bluetooth'){
        sendBluetoothMessage({type:'match', indices:[a,b]});
      }
    } else {
      log(`残念！違うカード。`);
      updateCardFlip(a,false);
      updateCardFlip(b,false);
      if(gameMode==='bluetooth'){
        sendBluetoothMessage({type:'no-match', indices:[a,b]});
        playerTurn = false;
        log("相手のターンです");
      }
    }
    flippedCards = [];
    canFlip = true;

    if(matchedCards.size === deck.length){
      log("全ペア達成！ゲームクリア！");
      if(gameMode==='bluetooth'){
        sendBluetoothMessage({type:'gameover'});
      }
    }
  }

  // --- ゲーム開始 ---
  function startGame(mode){
    gameMode = mode;
    deck = createDeck();
    flippedCards = [];
    matchedCards.clear();
    canFlip = true;
    playerTurn = (mode === 'bluetooth') ? true : false;
    bluetoothStatus.textContent = '';

    if(mode === 'bluetooth'){
      log("Bluetooth対戦モード開始。あなたのターンです。");
    } else if(mode === 'daily'){
      log("デイリーチャレンジ開始！");
    } else {
      log("一人プレイ開始！");
    }
    renderBoard();
  }

  // --- Bluetooth対戦部分（かなり簡易） ---
  async function startBluetoothConnection(){
    try {
      bluetoothStatus.textContent = 'Bluetooth接続中...デバイス選択してください';
      log("Bluetooth接続を開始します。");

      bluetoothDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
      });

      bluetoothStatus.textContent = `接続中：${bluetoothDevice.name}`;
      log(`デバイス接続成功: ${bluetoothDevice.name}`);

      bluetoothDevice.addEventListener('gattserverdisconnected', () => {
        bluetoothStatus.textContent = 'Bluetooth接続が切断されました。';
        log('Bluetooth切断されました。');
      });

      bluetoothServer = await bluetoothDevice.gatt.connect();
      const service = await bluetoothServer.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
      bluetoothCharacteristic = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');

      await bluetoothCharacteristic.startNotifications();
      bluetoothCharacteristic.addEventListener('characteristicvaluechanged', handleBluetoothMessage);

      log("Bluetooth接続完了。通信開始！");
      startGame('bluetooth');

      // 最初のデッキ情報を送信（ホスト想定）
      sendBluetoothMessage({type:'deck', deck: deck});
    } catch(e) {
      bluetoothStatus.textContent = 'Bluetooth接続に失敗しました。';
      log('Bluetooth接続エラー: ' + e.message);
    }
  }

  // --- Bluetoothメッセージ送信 ---
  async function sendBluetoothMessage(obj){
    if(!bluetoothCharacteristic) return;
    const msgStr = JSON.stringify(obj);
    const encoder = new TextEncoder();
    const data = encoder.encode(msgStr);
    try {
      await bluetoothCharacteristic.writeValue(data);
      log(`Bluetooth送信: ${msgStr}`);
    } catch(e){
      log('Bluetooth送信失敗: '+e.message);
    }
  }

  // --- Bluetoothメッセージ受信処理 ---
  function handleBluetoothMessage(event){
    const decoder = new TextDecoder();
    const msgStr = decoder.decode(event.target.value);
    log(`Bluetooth受信: ${msgStr}`);
    let msg;
    try {
      msg = JSON.parse(msgStr);
    } catch {
      log('Bluetooth受信デコード失敗');
      return;
    }

    if(msg.type === 'deck'){
      deck = msg.deck;
      flippedCards = [];
      matchedCards.clear();
      canFlip = true;
      playerTurn = false; // 待機側
      renderBoard();
      log("相手のデッキを受信しました。あなたのターンは後です。");
    } else if(msg.type === 'match'){
      msg.indices.forEach(i => matchedCards.add(i));
      renderBoard();
      log("相手がペアを見つけました。");
    } else if(msg.type === 'no-match'){
      msg.indices.forEach(i => updateCardFlip(i,false));
      playerTurn = true;
      log("相手はペアを見つけられませんでした。あなたのターンです。");
    } else if(msg.type === 'gameover'){
      log("相手が全ペア達成！ゲーム終了！");
    }
  }

  // --- データエクスポート ---
  function exportData(){
    const data = {
      playerName,
      matchedCards: Array.from(matchedCards),
      deck,
      gameMode
    };
    const jsonStr = JSON.stringify(data,null,2);
    const blob = new Blob([jsonStr], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memorygame_data.json';
    a.click();
    URL.revokeObjectURL(url);
    log("データをエクスポートしました。");
  }

  // --- データインポート ---
  function importData(jsonData){
    try {
      const data = JSON.parse(jsonData);
      if(data.deck && data.matchedCards){
        deck = data.deck;
        matchedCards = new Set(data.matchedCards);
        gameMode = data.gameMode || 'single';
        renderBoard();
        log("データをインポートしました。");
      } else {
        log("インポートデータの形式が不正です。");
      }
    } catch(e){
      log("データインポート失敗: "+e.message);
    }
  }

  // --- ファイル選択イベント ---
  importFileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) {
    log("ファイルが選択されていません。");
    return;
  }
  const reader = new FileReader();

  reader.onload = () => {
    try {
      importData(reader.result);
      log("ファイルのインポートが完了しました。");
    } catch (e) {
      log("インポート処理中にエラーが発生しました: " + e.message);
    }
    // 同じファイルを再選択可能にするためinputの値をクリア
    importFileInput.value = '';
  };

  reader.onerror = () => {
    log("ファイルの読み込み中にエラーが発生しました。");
  };

  reader.readAsText(file);
});
