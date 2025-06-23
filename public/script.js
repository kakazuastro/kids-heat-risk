/*
=============================================================================
子ども向け外遊び危険レベル判定アプリ
=============================================================================
このアプリは、お子様の外遊びのほぼ安全性を判定するためのWebアプリケーションです。

【主な機能】
- GPS機能で現在地を自動取得
- 最寄りの気象観測所データを取得
- 子どもの年齢に応じた危険レベル判定
- 写真撮影機能で状況を分析
- AIによる個別アドバイス生成

【技術構成】
- フロントエンド: HTML + CSS + JavaScript
- バックエンド: Google Cloud Functions (Python)
- API: 気象庁アメダスデータ + Gemini API
=============================================================================
*/

// アプリケーション開始
console.log('GPS機能付き外遊び危険レベル情報取得アプリ開始');

/*
=============================================================================
【ブロック1】観測所データ管理
=============================================================================
全国の気象観測所データを管理するためのコードです。
GPSで取得した現在地から、最寄りの観測所を自動で見つけます。
=============================================================================
*/

// 全国の観測所データを格納する変数
let AMEDAS_STATIONS = [];

// 観測所データを読み込む関数
// JSONファイルから全国の気象観測所データを取得します
async function loadAmedasStations() {
    try {
        const response = await fetch('./data/amedas_id.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        AMEDAS_STATIONS = await response.json();
        console.log(`[JS] 観測所データ読み込み完了: ${AMEDAS_STATIONS.length}箇所`);
        return AMEDAS_STATIONS;
    } catch (error) {
        console.error('観測所データの読み込みに失敗:', error);
        // フォールバック: 主要都市のみ
        AMEDAS_STATIONS = [
            { id: "44132", name: "東京", lat: 35.6895, lng: 139.6917, prefecture: "tokyo", region: "kanto" },
            { id: "44136", name: "練馬", lat: 35.7370, lng: 139.6569, prefecture: "tokyo", region: "kanto" },
            { id: "47772", name: "大阪", lat: 34.6937, lng: 135.5023, prefecture: "osaka", region: "kansai" },
            { id: "47636", name: "名古屋", lat: 35.1815, lng: 136.9066, prefecture: "aichi", region: "chubu" },
            { id: "82182", name: "福岡", lat: 33.5819, lng: 130.4011, prefecture: "fukuoka", region: "kyushu" },
            { id: "12741", name: "札幌", lat: 43.0642, lng: 141.3469, prefecture: "hokkaido", region: "hokkaido" },
            { id: "34106", name: "仙台", lat: 38.2681, lng: 140.8719, prefecture: "miyagi", region: "tohoku" },
            { id: "46106", name: "横浜", lat: 35.4437, lng: 139.6380, prefecture: "kanagawa", region: "kanto" },
            { id: "46141", name: "川崎", lat: 35.5513, lng: 139.6825, prefecture: "kanagawa", region: "kanto" },
            { id: "43041", name: "さいたま", lat: 35.8617, lng: 139.6453, prefecture: "saitama", region: "kanto" },
            { id: "43056", name: "熊谷", lat: 36.1450, lng: 139.3886, prefecture: "saitama", region: "kanto" },
            { id: "45142", name: "千葉", lat: 35.6058, lng: 140.1069, prefecture: "chiba", region: "kanto" },
            { id: "45212", name: "船橋", lat: 35.6943, lng: 139.9833, prefecture: "chiba", region: "kanto" },
            { id: "63106", name: "神戸", lat: 34.6913, lng: 135.1831, prefecture: "hyogo", region: "kansai" },
            { id: "91107", name: "那覇", lat: 26.2072, lng: 127.6792, prefecture: "okinawa", region: "okinawa" }
        ];
        console.log(`[JS] フォールバック観測所データ使用: ${AMEDAS_STATIONS.length}箇所`);
        return AMEDAS_STATIONS;
    }
}

// 地域別観測所（主要都市のみ - フォールバック用）
// データ読み込みに失敗した場合に使用する主要都市の観測所リスト
const REGIONAL_STATIONS = {
    hokkaido: [
        { id: "11016", name: "稚内" },
        { id: "12442", name: "旭川" },
        { id: "12741", name: "札幌" }
    ],
    tohoku: [
        { id: "31011", name: "青森" },
        { id: "34106", name: "仙台" },
        { id: "36056", name: "福島" }
    ],
    kanto: [
        { id: "44132", name: "東京" },
        { id: "44136", name: "練馬" },
        { id: "46106", name: "横浜" },
        { id: "46141", name: "川崎" },
        { id: "43041", name: "さいたま" },
        { id: "43056", name: "熊谷" },
        { id: "45142", name: "千葉" },
        { id: "45212", name: "船橋" }
    ],
    chubu: [
        { id: "47636", name: "名古屋" },
        { id: "50106", name: "新潟" },
        { id: "54106", name: "長野" }
    ],
    kansai: [
        { id: "47772", name: "大阪" },
        { id: "63106", name: "神戸" },
        { id: "61106", name: "京都" }
    ],
    kyushu: [
        { id: "81206", name: "北九州" },
        { id: "82012", name: "福岡" },  // 修正: 実際の福岡観測所ID
        { id: "85106", name: "熊本" },
        { id: "87376", name: "鹿児島" }
    ],
    okinawa: [
        { id: "91107", name: "那覇" }
    ]
};

// 都道府県別観測所データ（動的に生成）
// 指定した都道府県の観測所だけを抽出する関数
function getStationsByPrefecture(prefecture) {
    return AMEDAS_STATIONS.filter(station => station.prefecture === prefecture);
}

/*
=============================================================================
【ブロック2】GPS位置情報管理
=============================================================================
ユーザーの現在地を取得し、最寄りの気象観測所を見つけるためのコードです。
GPS機能を使って自動的に位置を特定します。
=============================================================================
*/

// GPS関連のデータを保存する変数
let currentLocation = null;  // ユーザーの現在地（緯度・経度）
let selectedStation = null;  // 選択された観測所の情報

// 距離計算関数
// 2つの地点間の距離を計算します（ヘイバーサイン公式使用）
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // 地球の半径（km）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 最寄り観測所を検索
// ユーザーの現在地から最も近い気象観測所を見つけます
function findNearestStation(userLat, userLng, maxDistance = 50) {
    let nearest = null;
    let minDistance = Infinity;
    
    AMEDAS_STATIONS.forEach(station => {
        const distance = calculateDistance(userLat, userLng, station.lat, station.lng);
        if (distance < minDistance && distance <= maxDistance) {
            minDistance = distance;
            nearest = { ...station, distance: distance };
        }
    });
    
    return nearest;
}

// GPS機能：現在地取得
// ブラウザのGeolocation APIを使って現在地を取得します
function requestLocation() {
    console.log('位置情報取得開始');
    
    const statusDiv = document.getElementById('locationStatus');
    const getLocationBtn = document.getElementById('getLocationBtn');
    
    if (statusDiv) {
        statusDiv.className = 'location-status warning';
        statusDiv.innerHTML = '<span class="status-icon">取得中</span> 位置情報を取得中...';
    }
    
    if (getLocationBtn) {
        getLocationBtn.disabled = true;
        getLocationBtn.textContent = '取得中...';
    }

    // Geolocation APIが利用可能かチェック
    if (!navigator.geolocation) {
        console.error('Geolocation API が利用できません');
        if (statusDiv) {
            statusDiv.className = 'location-status error';
            statusDiv.innerHTML = '<span class="status-icon">エラー</span> このブラウザでは位置情報がサポートされていません';
        }
        if (getLocationBtn) {
            getLocationBtn.disabled = false;
            getLocationBtn.textContent = '現在地を取得';
        }
        return;
    }

    console.log('Geolocation API 利用可能');

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5分間キャッシュ
    };

    navigator.geolocation.getCurrentPosition(
        function(position) {
            console.log('位置情報取得成功');
            handleLocationSuccess(position);
        },
        function(error) {
            console.error('位置情報取得失敗:', error);
            handleLocationError(error);
        },
        options
    );
}

// 位置情報取得成功
// GPS取得に成功した時の処理（最寄り観測所を自動選択）
function handleLocationSuccess(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    console.log(`緯度: ${latitude}`);
    console.log(`経度: ${longitude}`);
    console.log(`精度: ${accuracy}m`);

    currentLocation = { latitude, longitude, accuracy };

    const statusDiv = document.getElementById('locationStatus');
    const getLocationBtn = document.getElementById('getLocationBtn');
    const locationInfo = document.getElementById('locationInfo');

    // 最寄り観測所を検索
    const nearestStation = findNearestStation(latitude, longitude);

    if (nearestStation) {
        console.log(`最寄り観測所: ${nearestStation.name} (距離: ${nearestStation.distance.toFixed(1)}km)`);
        
        selectedStation = nearestStation;
        
        if (statusDiv) {
            statusDiv.className = 'location-status success';
            statusDiv.innerHTML = `<span class="status-icon">✅</span> 現在地: ${nearestStation.name}観測所 (${nearestStation.distance.toFixed(1)}km)`;
        }
        
        // 詳細情報を表示
        if (locationInfo) {
            document.getElementById('stationName').textContent = nearestStation.name;
            document.getElementById('stationDistance').textContent = nearestStation.distance.toFixed(1);
            document.getElementById('locationAccuracy').textContent = Math.round(accuracy);
            locationInfo.style.display = 'block';
        }
    } else {
        console.warn('近くに観測所が見つかりませんでした');
        if (statusDiv) {
            statusDiv.className = 'location-status warning';
            statusDiv.innerHTML = '<span class="status-icon">警告</span> 近くに観測所が見つかりませんでした（50km圏内）';
        }
    }

    if (getLocationBtn) {
        getLocationBtn.disabled = false;
        getLocationBtn.textContent = '現在地を再取得';
    }
}

// 位置情報取得失敗
// GPS取得に失敗した時のエラーハンドリング
function handleLocationError(error) {
    const statusDiv = document.getElementById('locationStatus');
    const getLocationBtn = document.getElementById('getLocationBtn');
    
    let message = '';
    let additionalInfo = '';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            message = '<span class="status-icon">エラー</span> 位置情報の利用が拒否されました';
            additionalInfo = '手動で観測所を選択できます';
            console.error('位置情報の利用が拒否されました');
            break;
        case error.POSITION_UNAVAILABLE:
            message = '<span class="status-icon">エラー</span> 位置情報が取得できませんでした';
            additionalInfo = '手動で観測所を選択してください';
            console.error('位置情報が取得できませんでした');
            break;
        case error.TIMEOUT:
            message = '<span class="status-icon">エラー</span> 位置情報の取得がタイムアウトしました';
            additionalInfo = '再試行または手動選択が可能です';
            console.error('位置情報の取得がタイムアウトしました');
            break;
        default:
            message = '<span class="status-icon">エラー</span> 位置情報の取得に失敗しました';
            additionalInfo = '手動で観測所を選択してください';
            console.error('位置情報の取得に失敗しました', error);
            break;
    }
    
    if (statusDiv) {
        statusDiv.className = 'location-status error';
        statusDiv.innerHTML = message + (additionalInfo ? `<br><small style="opacity: 0.8;">${additionalInfo}</small>` : '');
    }
    
    if (getLocationBtn) {
        getLocationBtn.disabled = false;
        getLocationBtn.textContent = '現在地を再取得';
    }
}

/*
=============================================================================
【ブロック3】手動観測所選択機能
=============================================================================
GPS取得に失敗した場合や、特定の観測所を指定したい場合に使用する
手動選択機能のコードです。
=============================================================================
*/

// 手動選択の表示切り替え
// 手動選択エリアの表示・非表示を切り替えます
function toggleManualSelect() {
    const manualDiv = document.getElementById('manualSelect');
    const isVisible = manualDiv && manualDiv.style.display === 'block';
    if (manualDiv) {
        manualDiv.style.display = isVisible ? 'none' : 'block';
    }
}

// 都道府県選択時の処理
// 選択された都道府県の観測所リストを表示します
function populateStationSelect(prefecture) {
    const stationSelect = document.getElementById('stationSelect');
    if (!stationSelect) return;
    
    stationSelect.innerHTML = '<option value="">観測所を選択</option>';
    
    const stations = getStationsByPrefecture(prefecture);
    stations.forEach(station => {
        const option = document.createElement('option');
        option.value = station.id;
        option.textContent = station.name;
        stationSelect.appendChild(option);
    });
    
    stationSelect.style.display = 'block';
}

// 観測所手動選択
// ユーザーが手動で選択した観測所を設定します
function selectStationManually(stationId) {
    console.log(`[JS DEBUG] selectStationManually関数呼び出し:`);
    console.log(`   - 渡されたstationId: ${stationId} (type: ${typeof stationId})`);
    console.log(`   - AMEDAS_STATIONS配列長: ${AMEDAS_STATIONS.length}`);
    
    const station = AMEDAS_STATIONS.find(s => s.id === stationId);
    console.log(`   - 見つかった観測所:`, station);
    
    if (station) {
        selectedStation = station;
        console.log(`[JS DEBUG] 観測所を手動選択:`);
        console.log(`   - 選択された観測所名: ${station.name}`);
        console.log(`   - 選択された観測所ID: ${station.id}`);
        console.log(`   - selectedStation更新:`, selectedStation);
        
        const statusDiv = document.getElementById('locationStatus');
        if (statusDiv) {
            statusDiv.className = 'location-status success';
            statusDiv.innerHTML = `<span class="status-icon">✅</span> 手動選択: ${station.name}観測所`;
        }
        
        // 手動選択エリアを閉じる
        const manualDiv = document.getElementById('manualSelect');
        if (manualDiv) {
            manualDiv.style.display = 'none';
        }
        
        console.log(`[JS DEBUG] 手動選択完了: ${station.name}観測所 (ID: ${station.id})`);
    } else {
        console.error(`[JS DEBUG] 観測所ID ${stationId} が見つかりません`);
        console.log(`   - 利用可能な観測所ID（例）:`, AMEDAS_STATIONS.slice(0, 5).map(s => s.id));
    }
}

/*
=============================================================================
【ブロック4】UI初期化とイベント設定
=============================================================================
ページが読み込まれた時に実行される初期化処理と、
各種ボタンやメニューのクリックイベントを設定します。
=============================================================================
*/

// ハンバーガーメニューの機能とアプリ初期化
// ページ読み込み完了時に実行される初期化処理
document.addEventListener('DOMContentLoaded', async function() {
    console.log('GPS機能付き外遊び危険レベル情報取得アプリ開始');
    
    // 観測所データを読み込み
    await loadAmedasStations();
    
    // アプリ起動時に自動的に位置情報を取得
    console.log('アプリ起動時の自動GPS取得を開始');
    setTimeout(() => {
        requestLocation();
    }, 1000); // 1秒後に自動実行（UIの初期化を待つため）
const hamburgerMenu = document.getElementById('hamburgerMenu');
const sideMenu = document.getElementById('sideMenu');
const overlay = document.getElementById('overlay');

// ハンバーガーメニューのクリック
hamburgerMenu.addEventListener('click', function() {
    hamburgerMenu.classList.toggle('active');
    sideMenu.classList.toggle('active');
    overlay.classList.toggle('active');
});

// オーバーレイクリックでメニューを閉じる
overlay.addEventListener('click', function() {
    hamburgerMenu.classList.remove('active');
    sideMenu.classList.remove('active');
    overlay.classList.remove('active');
});

// ESCキーでメニューとモーダルを閉じる
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
    // メニューを閉じる
    hamburgerMenu.classList.remove('active');
    sideMenu.classList.remove('active');
    overlay.classList.remove('active');
    
    // 開いているモーダルを閉じる
    document.querySelectorAll('.modal.active').forEach(modal => {
        modal.classList.remove('active');
    });
    }
});

// GPS関連のイベントリスナー設定
const getLocationBtn = document.getElementById('getLocationBtn');
if (getLocationBtn) {
    getLocationBtn.addEventListener('click', function() {
        console.log('現在地取得ボタンがクリックされました');
        requestLocation();
    });
}

const manualBtn = document.getElementById('manualBtn');
if (manualBtn) {
    manualBtn.addEventListener('click', function() {
        console.log('手動選択ボタンがクリックされました');
        toggleManualSelect();
    });
}

const prefectureSelect = document.getElementById('prefectureSelect');
if (prefectureSelect) {
    prefectureSelect.addEventListener('change', function() {
        const prefecture = this.value;
        console.log('都道府県選択:', prefecture);
        if (prefecture) {
            populateStationSelect(prefecture);
        }
    });
}

const stationSelect = document.getElementById('stationSelect');
if (stationSelect) {
    stationSelect.addEventListener('change', function() {
        const stationId = this.value;
        console.log('観測所選択:', stationId);
        if (stationId) {
            selectStationManually(stationId);
        }
    });
}

// 年齢グループの初期化
const checkedRadio = document.querySelector('input[name="ageGroup"]:checked');
if (checkedRadio) {
    checkedRadio.closest('.age-group-option').classList.add('selected');
}

// 画像関連のイベントリスナーを設定
setupImageHandlers();

console.log('GPS機能付きアプリ - イベントリスナー設定完了');
});

/*
=============================================================================
【ブロック5】モーダル・UI制御機能
=============================================================================
情報表示用のモーダルウィンドウや、各種UI要素の制御を行うコードです。
=============================================================================
*/

// モーダル関連の機能
// 情報表示用のモーダルウィンドウを開きます
function openModal(modalId) {
// メニューを閉じる
document.getElementById('hamburgerMenu').classList.remove('active');
document.getElementById('sideMenu').classList.remove('active');
document.getElementById('overlay').classList.remove('active');

// モーダルを開く
const modal = document.getElementById(modalId);
if (modal) {
    modal.classList.add('active');
}
}

// モーダルを閉じる
function closeModal(modalId) {
const modal = document.getElementById(modalId);
if (modal) {
    modal.classList.remove('active');
}
}

// データ更新機能
// ページ全体を再読み込みして最新データを取得します
function refreshData() {
    // メニューを閉じる
    document.getElementById('hamburgerMenu').classList.remove('active');
    document.getElementById('sideMenu').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
    
    // ページ全体を更新（ブラウザの更新ボタンと同じ動作）
    location.reload();
}

// モーダルの背景クリックで閉じる
document.addEventListener('click', function(e) {
if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
}
});

/*
=============================================================================
【ブロック6】画像撮影・比較機能
=============================================================================
外出前後の画像を撮影・アップロードして、AIが状況を分析するための機能です。
写真の撮影、プレビュー表示、画像比較などを行います。
=============================================================================
*/

// 画像関連のグローバル変数
let currentStream = null;      // カメラストリーム
let beforeImageData = null;    // 外出前の画像データ
let afterImageData = null;     // 帰宅後の画像データ
let beforeTimestamp = null;    // 外出前の撮影時刻
let afterTimestamp = null;     // 帰宅後の撮影時刻

// 年齢グループ選択の視覚的フィードバック
// 年齢グループを選択した時の見た目を変更します
document.querySelectorAll('input[name="ageGroup"]').forEach(radio => {
radio.addEventListener('change', function() {
    // すべてのオプションから選択状態を削除
    document.querySelectorAll('.age-group-option').forEach(option => {
    option.classList.remove('selected');
    });
    
    // 選択されたオプションに選択状態を追加
    if (this.checked) {
    this.closest('.age-group-option').classList.add('selected');
    }
});
});

// 年齢グループオプション全体をクリック可能にする
document.querySelectorAll('.age-group-option').forEach(option => {
option.addEventListener('click', function() {
    const radio = this.querySelector('input[type="radio"]');
    if (radio && !radio.checked) {
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    }
});
});

// 画像撮影・アップロード機能
document.addEventListener('DOMContentLoaded', function() {
const checkedRadio = document.querySelector('input[name="ageGroup"]:checked');
if (checkedRadio) {
    checkedRadio.closest('.age-group-option').classList.add('selected');
}

// 画像関連のイベントリスナーを設定
setupImageHandlers();
});

// 画像ハンドラーの初期設定
// 外出前・帰宅後の画像アップロード機能を初期化します
function setupImageHandlers() {
// 外出前画像のイベントリスナー
setupImageHandlersForType('before');

// 帰宅後画像のイベントリスナー
setupImageHandlersForType('after');
}

// 画像タイプ別イベント設定
// 外出前・帰宅後それぞれの画像機能を設定します
function setupImageHandlersForType(type) {
const fileInput = document.getElementById(`${type}FileInput`);
const removeImage = document.getElementById(`${type}RemoveImage`);

// ファイル選択イベント
fileInput.addEventListener('change', (event) => handleFileSelect(event, type));

// 画像削除ボタンのクリックイベント
if (removeImage) {
    removeImage.addEventListener('click', () => removeSelectedImage(type));
}
}

// ファイル選択処理
// ユーザーが選択した画像ファイルを処理します
function handleFileSelect(event, type) {
const file = event.target.files[0];
if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(e) {
    const imageDataUrl = e.target.result;
    const timestamp = new Date();
    
    // 画像データとタイムスタンプを保存
    if (type === 'before') {
        beforeImageData = imageDataUrl;
        beforeTimestamp = timestamp;
    } else {
        afterImageData = imageDataUrl;
        afterTimestamp = timestamp;
    }
    
    // プレビューを表示
    showImagePreview(imageDataUrl, `${type === 'before' ? '外出前' : '帰宅後'}の選択画像: ${file.name}`, type);
    
    // ステータス更新
    updateImageStatus(type);
    
    // 2枚の画像が揃ったら比較表示
    if (beforeImageData && afterImageData) {
        showImageComparison();
    }
    };
    reader.readAsDataURL(file);
} else {
    alert('画像ファイルを選択してください。');
}
}

// 画像プレビュー表示
// 選択した画像をプレビューエリアに表示します
function showImagePreview(imageDataUrl, info, type) {
const imagePreview = document.getElementById(`${type}ImagePreview`);
const previewImage = document.getElementById(`${type}PreviewImage`);
const imageInfo = document.getElementById(`${type}ImageInfo`);

previewImage.src = imageDataUrl;
imageInfo.textContent = info;
imagePreview.style.display = 'block';
}

// 選択画像の削除
// アップロードした画像を削除してリセットします
function removeSelectedImage(type) {
// 画像データとタイムスタンプをリセット
if (type === 'before') {
    beforeImageData = null;
    beforeTimestamp = null;
} else {
    afterImageData = null;
    afterTimestamp = null;
}

// プレビューを非表示
document.getElementById(`${type}ImagePreview`).style.display = 'none';

// ファイル入力をリセット
document.getElementById(`${type}FileInput`).value = '';

// ステータス更新
updateImageStatus(type);

// 比較表示を非表示（2枚揃っていない場合）
if (!beforeImageData || !afterImageData) {
    document.getElementById('imageComparison').style.display = 'none';
}
    }

// 画像ステータス更新
// 画像の撮影状況を表示に反映します
function updateImageStatus(type) {
const statusElement = document.getElementById(`${type}Status`);
const hasImage = type === 'before' ? beforeImageData : afterImageData;

if (hasImage) {
    statusElement.textContent = '撮影完了';
    statusElement.className = 'status-badge status-completed';
} else {
    statusElement.textContent = '未撮影';
    statusElement.className = 'status-badge status-pending';
}
}

// 画像比較表示
// 外出前後の画像を並べて比較表示します
function showImageComparison() {
const imageComparison = document.getElementById('imageComparison');
const comparisonBefore = document.getElementById('comparisonBefore');
const comparisonAfter = document.getElementById('comparisonAfter');
const beforeTimestampEl = document.getElementById('beforeTimestamp');
const afterTimestampEl = document.getElementById('afterTimestamp');

comparisonBefore.src = beforeImageData;
comparisonAfter.src = afterImageData;

if (beforeTimestamp) {
    beforeTimestampEl.textContent = beforeTimestamp.toLocaleString('ja-JP');
}
if (afterTimestamp) {
    afterTimestampEl.textContent = afterTimestamp.toLocaleString('ja-JP');
}

imageComparison.style.display = 'block';
}

/*
=============================================================================
【ブロック7】データ処理・API通信機能
=============================================================================
バックエンドAPIとの通信を行い、気象データを取得して危険レベルを判定します。
プログレス表示や結果の表示制御も含まれます。
=============================================================================
*/

// プログレス管理
// 処理の進行状況をプログレスバーで表示します
function updateProgress(step, total, message) {
const progressFill = document.querySelector('.progress-fill');
const progressSteps = document.querySelectorAll('.progress-step');

if (progressFill) {
    const percentage = (step / total) * 100;
    progressFill.style.width = percentage + '%';
    
    progressSteps.forEach((stepEl, index) => {
    stepEl.classList.remove('active');
    if (index < step) {
        stepEl.classList.add('completed');
    } else if (index === step) {
        stepEl.classList.add('active');
    } else {
        stepEl.classList.remove('completed');
    }
    });
}
}

// 段階的にコンテンツを表示
// 結果を段階的にアニメーション表示します
function showStage(stageId, delay = 0) {
setTimeout(() => {
    const stage = document.getElementById(stageId);
    if (stage) {
    stage.classList.add('visible');
    }
}, delay);
}

// メイン処理：外遊び危険レベル判定実行
// 「外遊び危険レベル判定」ボタンが押された時のメイン処理
document.getElementById('fetchButton').addEventListener('click', async function() {
const button = this;
const outputDiv = document.getElementById('output');
const ageGroup = document.querySelector('input[name="ageGroup"]:checked').value;

// ボタンを無効化
button.disabled = true;
    button.textContent = 'AI分析中...';

// プログレス表示を初期化
outputDiv.innerHTML = `
    <div class="progress-container">
    <div class="progress-bar">
        <div class="progress-fill"></div>
    </div>
    <div class="progress-steps">
        <div class="progress-step active">データ取得</div>
                  <div class="progress-step">計算中...</div>
        <div class="progress-step">分析中...</div>
        <div class="progress-step">結果表示</div>
    </div>
    </div>
    <div class="ai-analyzing">
    <div class="ai-spinner"></div>
    <span>気象データを取得しています...（プログラム処理）</span>
    </div>
`;

try {
    console.log('API呼び出し開始 - 年齢グループ:', ageGroup);
    updateProgress(0, 4, '気象データを取得しています...');
    
    // CORS回避のため複数の方法を試行
    let data = null;
    let success = false;
    
    // リクエストペイロードの構築
    let requestPayload = {
    age_group: ageGroup,
    detailed: true
    };
    
    // 選択された観測所情報を追加
    if (selectedStation) {
        requestPayload.station_id = selectedStation.id;
        requestPayload.station_name = selectedStation.name;
        requestPayload.location = {
            latitude: selectedStation.lat,
            longitude: selectedStation.lng
        };
        console.log(`[JS DEBUG] 観測所情報が選択されています:`);
        console.log(`   - 観測所名: ${selectedStation.name}`);
        console.log(`   - 観測所ID: ${selectedStation.id} (type: ${typeof selectedStation.id})`);
        console.log(`   - 緯度: ${selectedStation.lat}`);
        console.log(`   - 経度: ${selectedStation.lng}`);
        console.log(`   - selectedStation全体:`, selectedStation);
        console.log(`[JS DEBUG] 送信するrequestPayload (観測所選択時):`, requestPayload);
    } else if (currentLocation) {
        requestPayload.location = {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude
        };
        console.log(`[JS DEBUG] GPS位置情報を使用:`);
        console.log(`   - GPS緯度: ${currentLocation.latitude}`);
        console.log(`   - GPS経度: ${currentLocation.longitude}`);
        console.log(`   - currentLocation全体:`, currentLocation);
        console.log(`[JS DEBUG] 送信するrequestPayload (GPS使用時):`, requestPayload);
    } else {
        console.log(`[JS DEBUG] 観測所・GPS情報なし - デフォルト使用`);
        console.log(`   - selectedStation: ${selectedStation}`);
        console.log(`   - currentLocation: ${currentLocation}`);
        console.log(`[JS DEBUG] 送信するrequestPayload (デフォルト):`, requestPayload);
    }
    
    // 画像データがある場合は追加
    if (beforeImageData && afterImageData) {
    // 2枚の画像がある場合は差分分析
    requestPayload.before_image = beforeImageData.split(',')[1];
    requestPayload.after_image = afterImageData.split(',')[1];
    requestPayload.before_timestamp = beforeTimestamp ? beforeTimestamp.toISOString() : null;
    requestPayload.after_timestamp = afterTimestamp ? afterTimestamp.toISOString() : null;
    requestPayload.include_comparison_analysis = true;
    } else if (beforeImageData || afterImageData) {
    // 1枚の画像がある場合は通常の画像分析
    const imageData = beforeImageData || afterImageData;
    requestPayload.image_data = imageData.split(',')[1];
    requestPayload.include_image_analysis = true;
    }
    
    // プログレス更新
    updateProgress(1, 4, '外遊び危険レベル計算中...');
    document.querySelector('.ai-analyzing span').textContent = '外遊び危険レベルを計算しています...（プログラム処理）';
    
    // 1つ目: 直接API呼び出し (CORS対応)
    try {
    console.log('方法1試行: 直接API呼び出し');
    
    // AI分析段階の表示
    setTimeout(() => {
        updateProgress(2, 4, '分析中...');
        let analyzeText = 'AIでアドバイスを生成しています...（AI処理）';
        
        if (beforeImageData && afterImageData) {
        analyzeText = 'AIで外出前後の画像差分と気象データを統合分析しています...（AI処理）';
        } else if (beforeImageData || afterImageData) {
        analyzeText = 'AIで気象データと画像を統合分析しています...（AI処理）';
        }
        
        document.querySelector('.ai-analyzing span').textContent = analyzeText;
    }, 500);
    
    const response1 = await fetch('https://kids-heat-risk-dev-865761751183.asia-northeast1.run.app', {
        method: 'POST',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
    });
    
    if (response1.ok) {
        data = await response1.json();
        success = true;
        console.log('方法1成功 - 直接API呼び出し:', data);
    } else {
        console.log('方法1失敗 - レスポンスエラー:', response1.status, response1.statusText);
    }
    } catch (error) {
    console.log('方法1失敗 - 直接API呼び出し:', error.message);
    }

    // 2つ目: CORS Anywhere経由（GETリクエストのフォールバック）
    if (!success) {
    try {
        console.log('方法2試行: CORS Anywhere経由（GET）');
        
        // 観測所情報をクエリパラメータに追加
        let queryParams = `?age_group=${encodeURIComponent(ageGroup)}&detailed=true`;
        if (selectedStation) {
            queryParams += `&station_id=${encodeURIComponent(selectedStation.id)}&station_name=${encodeURIComponent(selectedStation.name)}`;
            console.log(`[JS] 方法2用観測所指定: ${selectedStation.name} (ID: ${selectedStation.id})`);
            console.log(`[JS] 方法2用クエリパラメータ: ${queryParams}`);
        } else {
            console.log(`[JS] 方法2: 観測所情報なし - デフォルト使用`);
        }
        
        const proxyUrl = `https://cors-anywhere.herokuapp.com/https://kids-heat-risk-865761751183.asia-northeast1.run.app${queryParams}`;
        const response2 = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
        });
        
        if (response2.ok) {
        data = await response2.json();
        success = true;
        console.log('方法2成功 - CORS Anywhere経由:', data);
        } else {
        console.log('方法2失敗 - レスポンスエラー:', response2.status, response2.statusText);
        }
    } catch (error) {
        console.log('方法2失敗 - CORS Anywhere経由:', error.message);
    }
    }

    // 3つ目: AllOrigins経由（GETリクエストのフォールバック）
    if (!success) {
    try {
        console.log('方法3試行: AllOrigins経由（GET）');
        
        // 観測所情報をクエリパラメータに追加
        let queryParams = `?age_group=${encodeURIComponent(ageGroup)}&detailed=true`;
        if (selectedStation) {
            queryParams += `&station_id=${encodeURIComponent(selectedStation.id)}&station_name=${encodeURIComponent(selectedStation.name)}`;
            console.log(`[JS] 方法3用観測所指定: ${selectedStation.name} (ID: ${selectedStation.id})`);
            console.log(`[JS] 方法3用クエリパラメータ: ${queryParams}`);
        } else {
            console.log(`[JS] 方法3: 観測所情報なし - デフォルト使用`);
        }
        
        const proxyUrl2 = 'https://api.allorigins.win/get?url=' + encodeURIComponent(`https://kids-heat-risk-poc-865761751183.asia-northeast1.run.app${queryParams}`);
        const response3 = await fetch(proxyUrl2);
        
        if (response3.ok) {
        const proxyData = await response3.json();
        if (proxyData.contents) {
            data = JSON.parse(proxyData.contents);
            success = true;
            console.log('方法3成功 - AllOrigins経由:', data);
        } else {
            console.log('方法3失敗 - contentsが空');
        }
        } else {
        console.log('方法3失敗 - レスポンスエラー:', response3.status, response3.statusText);
        }
    } catch (error) {
        console.log('方法3失敗 - AllOrigins経由:', error.message);
    }
    }
    
    // 結果の処理
    updateProgress(3, 4, '結果を表示中...');
    document.querySelector('.ai-analyzing span').textContent = '結果を表示しています...';
    
    if (success && data) {
    console.log('API呼び出し成功 - 取得データ:', data);
    console.log('APIレスポンス - age_group_analysis:', data.age_group_analysis);
    
    // 観測所情報の確認を追加
    if (data.observation) {
        console.log(`[JS DEBUG] APIレスポンスの観測所情報:`);
        console.log(`   - station: ${data.observation.station}`);
        console.log(`   - station_id: ${data.observation.station_id}`);
        console.log(`   - time: ${data.observation.time}`);
        console.log(`   - temperature: ${data.observation.temperature}`);
        
        // 送信した情報と比較
        if (selectedStation) {
            console.log(`[JS DEBUG] 送信vs受信比較:`);
            console.log(`   - 送信ID: ${selectedStation.id} vs 受信ID: ${data.observation.station_id}`);
            console.log(`   - 送信名: ${selectedStation.name} vs 受信名: ${data.observation.station}`);
            console.log(`   - ID一致: ${selectedStation.id === data.observation.station_id}`);
            
            if (selectedStation.id !== data.observation.station_id) {
                console.warn(`[JS DEBUG] 観測所IDが一致しません！`);
                console.warn(`   送信: ${selectedStation.id}, 受信: ${data.observation.station_id}`);
            }
        }
    }
    
    // プログレス完了
    updateProgress(4, 4, '完了');
    
    // 短い遅延後に結果を表示
    setTimeout(() => {
        displayData(data);
    }, 500);
    } else {
    console.log('すべてのAPI呼び出しが失敗しました');
    // エラーデータを表示
    const errorData = {
        "error": "API接続失敗",
        "message": "すべてのAPIエンドポイントへの接続に失敗しました。しばらく時間をおいて再度お試しください。",
        "timestamp": new Date().toLocaleString('ja-JP'),
        "ai_features": { "enabled": false, "fallback_mode": true }
    };
    
    setTimeout(() => {
        displayData(errorData);
    }, 500);
    }
    
} catch (error) {
    console.error('エラー詳細:', error);
    outputDiv.innerHTML = `
    <div class="error">
        <strong>エラーが発生しました:</strong><br>
        ${error.message}<br>
        <br>
        <strong>解決方法:</strong><br>
        1. ブラウザの開発者ツール（F12）でコンソールを確認<br>
        2. CORSエラーの場合は、サーバー側でCORS設定が必要<br>
        3. または、別のブラウザで試してください<br>
        <br>
        <button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
        ページを再読み込み
        </button>
    </div>
    `;
} finally {
    // ボタンを再有効化
    button.disabled = false;
    button.textContent = '外遊び危険レベル判定';
}
    });

// AIメッセージを箇条書き形式でフォーマットする関数
function formatAiMessageWithBullets(message) {
    if (!message) return '';

    // マークダウン記法を削除（**を削除）
    let cleanedMessage = message.replace(/\*\*/g, '');
    
    // ○の前に改行を入れる（文頭以外）
    cleanedMessage = cleanedMessage.replace(/([^。\n])○/g, '$1<br>○');
    
    // 改行を<br>に変換
    cleanedMessage = cleanedMessage.replace(/\n/g, '<br>');
    
    return cleanedMessage;
}



// 年齢別対策を生成する関数
function getAgeSpecificGuidance(ageGroup) {
    const guidanceData = {
        '0-1': {
            title: '0-1歳（乳児）基本注意点',
            items: [
                {
                    title: '水分補給',
                    content: '体調について話せないため、保護者による頻繁な水分補給<br>授乳・ミルクの回数を増やす<br>母乳育児の場合はお母さんも水分補給を'
                },
                {
                    title: '観察のポイント',
                    content: '顔色・呼吸・泣き声の変化を頻繁にチェック<br>普段より静かになったり、ぐったりしていないか<br>汗の量や体温の変化に注意'
                },
                {
                    title: '避けるべきこと',
                    content: '車内や密閉空間に放置しない<br>直射日光や高温環境は避ける<br>厚着や重ね着をさせない'
                }
            ]
        },
        '2-3': {
            title: '2-3歳（幼児）基本注意点',
            items: [
                {
                    title: '水分補給',
                    content: '体調の前兆が分からないため、定期的な声かけ<br>好きな飲み物で楽しく水分補給<br>ストローマグなど飲みやすい容器を使用'
                },
                {
                    title: '観察のポイント',
                    content: '元気さや機嫌の変化をチェック<br>汗の量や顔色の変化に注意<br>普段と違う様子がないか確認'
                },
                {
                    title: '環境への配慮',
                    content: '帽子着用を習慣づける<br>こまめな着替えを準備<br>日陰での活動を心がける'
                }
            ]
        },
        '4-6': {
            title: '4-6歳（園児）基本注意点',
            items: [
                {
                    title: '水分補給',
                    content: '自分でも体調を伝えられるが、忘れがちなので声かけ<br>「のどが渇いた」と感じる前の補給<br>薄めた飲み物で適切な塩分も補給'
                },
                {
                    title: 'コミュニケーション',
                    content: '体調の変化を大人に伝える練習<br>「頭が痛い」「気分が悪い」を言えるように<br>「今日は元気？」の定期的な確認'
                },
                {
                    title: '活動の工夫',
                    content: '遊びと休憩のバランスを取る<br>涼しい時間帯の活動を選ぶ<br>水遊びなど体温調節できる遊びを取り入れる'
                }
            ]
        }
    };

    const guidance = guidanceData[ageGroup] || guidanceData['2-3'];
    
    return `
        <div style="text-align: center; margin-bottom: 16px;">
            <div style="font-size: 14px; font-weight: 600; color: #333;">
                ${guidance.title}
            </div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 16px;">
            ${guidance.items.map(item => `
                <div style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 16px; background: linear-gradient(135deg, #f8f9fa, #ffffff);">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span style="font-size: 14px; font-weight: 600; color: #333;">${item.title}</span>
                    </div>
                    <div style="font-size: 13px; line-height: 1.5; color: #666;">
                        ${item.content}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/*
=============================================================================
【ブロック8】結果表示・UI描画機能
=============================================================================
APIから取得したデータを整理して、美しいUIで結果を表示するためのコードです。
危険レベルの色分け、プログレスバー、各種カードの表示を行います。
=============================================================================
*/

// 結果データの表示処理
// APIから取得したデータを整理してUIに表示します
function displayData(data) {
const outputDiv = document.getElementById('output');

// AI機能の状態確認
const aiFeatures = data.ai_features || {};
const ageGroupAnalysis = data.age_group_analysis || {};
const aiEnabled = aiFeatures.enabled === true;
const aiGenerated = ageGroupAnalysis.ai_generated === true;

// エラー状態の確認
if (data.error) {
    const errorColor = '#dc3545';
    
    outputDiv.innerHTML = `
    <!-- エラー時の円形表示 -->
    <div class="wbgt-circle unknown">
        <div class="wbgt-number">?</div>
        <div class="wbgt-label">外遊び危険レベル</div>
        <div class="wbgt-level unknown">不明</div>
    </div>
    
    <!-- エラーメッセージカード -->
    <div class="risk-level unknown">
        <div class="risk-level-main">${data.error}</div>
        <div class="risk-level-description">
        ${data.message || 'データ取得に失敗しました。ネットワーク接続を確認してください。'}
        </div>
    </div>
    
    <!-- 観測情報（エラー状態） -->
    <div class="info-card">
        <div class="info-card-title">観測</div>
        <div class="data-item">
        <span class="data-label">観測</span>
        <span class="data-value">${data.timestamp || '不明'}</span>
        </div>
        <div class="data-item">
        <span class="data-label">気温</span>
        <span class="data-value">不明</span>
        </div>
        <div class="data-item">
        <span class="data-label">湿度</span>
        <span class="data-value">不明</span>
        </div>
        <div class="data-item">
        <span class="data-label">風速</span>
        <span class="data-value">不明</span>
        </div>
        <div class="data-item">
        <span class="data-label">日射量</span>
        <span class="data-value">ー</span>
        </div>
    </div>
    
    <!-- 基本推奨事項 -->
    <div class="recommendation-card unknown">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">
データ不足時の基本対策
        </div>
        <div style="font-size: 14px; line-height: 1.6; opacity: 0.95;">
        データが取得できない場合でも、ほぼ安全のため以下の対策を心がけてください：<br>
        • こまめな水分補給<br>
        • 適度な休憩<br>
        • 日陰の利用<br>
        • 帽子の着用
        </div>
        <div style="margin-top: 12px; font-size: 11px; opacity: 0.8;">
基本テンプレート
        </div>
    </div>
    `;
    
    return;
}

// pythonの正常データ構造に対応
const observation = data.observation || {};
const wbgtAnalysis = data.wbgt_analysis || {};
const childTempAnalysis = data.child_temperature_analysis || {};
const safetyRecommendations = data.safety_recommendations || {};
const metadata = data.metadata || {};

// 外遊び危険レベルの判定
// 計算された危険レベル値から色やクラスを決定します（年齢別基準対応）
function getWBGTRiskInfo(wbgt, providedRiskLevel, ageGroup) {
    if (wbgt === null || wbgt === undefined || isNaN(wbgt)) {
    return { level: '不明', color: '#607D8B', class: 'unknown', icon: '' };
    }
    
    const wbgtNum = parseFloat(wbgt);
    
    // 年齢別の閾値（バックエンドと同じ基準・危険レベル3段階）
    const thresholds = {
    "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険レベル1": 25, "高危険レベル2": 28, "非常に危険レベル3": 31},
    "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険レベル1": 26, "高危険レベル2": 29, "非常に危険レベル3": 32},
    "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険レベル1": 27, "高危険レベル2": 30, "非常に危険レベル3": 33}
    };
    
    
    // デフォルトは2-3歳の基準を使用
    const currentThresholds = thresholds[ageGroup] || thresholds["2-3"];
    
            if (wbgtNum >= currentThresholds["非常に危険レベル3"]) {
    return { level: '非常に危険レベル3', color: '#740303', class: 'extreme-danger', icon: '' };
    } else if (wbgtNum >= currentThresholds["高危険レベル2"]) {
    return { level: '高危険レベル2', color: '#E53E3E', class: 'high-danger', icon: '' };
    } else if (wbgtNum >= currentThresholds["危険レベル1"]) {
    return { level: '危険レベル1', color: '#FF6B6B', class: 'danger', icon: '' };
    } else if (wbgtNum >= currentThresholds["厳重警戒"]) {
    return { level: '厳重警戒', color: '#FF8C42', class: 'severe', icon: '' };
    } else if (wbgtNum >= currentThresholds["警戒"]) {
    return { level: '警戒', color: '#FFB74D', class: 'warning', icon: '' };
    } else if (wbgtNum >= currentThresholds["注意"]) {
    return { level: '注意', color: '#FFEB3B', class: 'caution', icon: '' };
    } else {
    return { level: 'ほぼ安全', color: '#4CAF50', class: 'safe', icon: '' };
    }
}

const wbgtValue = wbgtAnalysis.wbgt;
const providedRiskLevel = ageGroupAnalysis.risk_level;
// ユーザーが選択した年齢を取得
const userSelectedAge = document.querySelector('input[name="ageGroup"]:checked').value;
// APIレスポンスがない場合はユーザー選択を使用
const targetAgeGroup = ageGroupAnalysis.target_age_group || userSelectedAge || '2-3';

console.log('ユーザー選択年齢:', userSelectedAge); // デバッグ用
console.log('API返却年齢:', ageGroupAnalysis.target_age_group); // デバッグ用
console.log('最終使用年齢:', targetAgeGroup); // デバッグ用
console.log('ageGroupAnalysis全体:', ageGroupAnalysis); // デバッグ用
const riskInfo = getWBGTRiskInfo(wbgtValue, providedRiskLevel, targetAgeGroup);

const riskLevel = riskInfo.level;
const riskColor = riskInfo.color;
const riskClass = riskInfo.class;
const riskIcon = riskInfo.icon;

// 年齢グループに応じた表示名
const ageGroupNames = {
    "0-1": "0-1歳（乳児）",
    "2-3": "2-3歳（幼児）", 
    "4-6": "4-6歳（幼児・園児）",
    "adult": "大人（成人）"
};

// 画像のような円形プログレスバー付き表示構造
const displayWbgtValue = wbgtAnalysis.wbgt !== null && wbgtAnalysis.wbgt !== undefined ? Math.round(wbgtAnalysis.wbgt) : 25;

// 円形プログレスバーの進行度計算
// 危険レベルに応じて円形プログレスバーの進行度を計算します
function calculateProgressPercentage(wbgtValue, ageGroup) {
    const thresholds = {
        "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険レベル1": 25, "高危険レベル2": 28, "非常に危険レベル3": 31},
        "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険レベル1": 26, "高危険レベル2": 29, "非常に危険レベル3": 32},
        "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険レベル1": 27, "高危険レベル2": 30, "非常に危険レベル3": 33}
    };
    
    const currentThresholds = thresholds[ageGroup] || thresholds["2-3"];
    
    // 危険度レベルを判定
    let riskLevel = 'ほぼ安全';
    if (wbgtValue >= currentThresholds["非常に危険レベル3"]) {
        riskLevel = '非常に危険レベル3';
    } else if (wbgtValue >= currentThresholds["高危険レベル2"]) {
        riskLevel = '高危険レベル2';
    } else if (wbgtValue >= currentThresholds["危険レベル1"]) {
        riskLevel = '危険レベル1';
    } else if (wbgtValue >= currentThresholds["厳重警戒"]) {
        riskLevel = '厳重警戒';
    } else if (wbgtValue >= currentThresholds["警戒"]) {
        riskLevel = '警戒';
    } else if (wbgtValue >= currentThresholds["注意"]) {
        riskLevel = '注意';
    }
    
         // 危険度レベルに応じてプログレス進行度を設定（画像の例に基づく）
     switch(riskLevel) {
         case '非常に危険レベル3':
             return 92; // ほぼ完全な円（最高危険）
         case '高危険レベル2':
             return 82; // 82%の進行度
         case '危険レベル1':
             return 72; // 72%の進行度（画像左側のような状態）
         case '厳重警戒':
             return 58; // 58%の進行度
         case '警戒':
             return 42; // 42%の進行度（画像中央のような状態）
         case '注意':
             return 28; // 28%の進行度
         case 'ほぼ安全':
             return 18; // 18%の進行度（画像右側のような状態）
         default:
             return 25; // デフォルト値
     }
}

const progressPercentage = calculateProgressPercentage(displayWbgtValue, targetAgeGroup);

// 危険度レベルに応じてプログレスバーのストローク（色/グラデーション）を決定
// プログレス円の色設定
// 危険レベルに応じて円形プログレスバーの色を決定します
function getProgressStroke(level, fallbackColor) {
    // 背景色より少し明度を上げた色を使用（視認性と統一感の両立）
    switch(level) {
        case 'ほぼ安全':
            return '#66BB6A'; // 背景緑より明るい緑
        case '注意': 
            return '#FFF176'; // 背景黄色より明るい黄色
        case '警戒':
            return '#FFCC80'; // 背景オレンジより明るいオレンジ
        case '厳重警戒':
            return '#FFAB40'; // 背景濃いオレンジより明るいオレンジ
        case '危険レベル1':
            return '#FF6B6B'; // 背景赤より明るい赤
        case '高危険レベル2':
            return '#B71C1C'; // 背景ワインレッドより明るい赤
        case '非常に危険レベル3':
            return '#A31515'; // 背景暗い赤より明るい赤
        default:
            return fallbackColor || '#66BB6A';
    }
    

}

// 🔘 背景円の色設定
// 危険度レベルに応じて背景円の色を決定します（コントラスト強化）
function getProgressBackgroundColor(level) {
    switch(level) {
        case 'ほぼ安全':
            return 'rgba(255, 255, 255, 0.3)'; // 白い背景円
        case '注意':
            return 'rgba(255, 255, 255, 0.3)'; // 白い背景円
        case '警戒':
            return 'rgba(255, 255, 255, 0.3)'; // 白い背景円
        case '厳重警戒':
            return 'rgba(255, 255, 255, 0.3)'; // 白い背景円
        case '危険レベル1':
            return 'rgba(255, 255, 255, 0.4)'; // より明るい白い背景円
        case '高危険レベル2':
            return 'rgba(255, 255, 255, 0.4)'; // より明るい白い背景円
        case '非常に危険レベル3':
            return 'rgba(255, 255, 255, 0.5)'; // 最も明るい白い背景円
        default:
            return 'rgba(255, 255, 255, 0.3)';
    }
}

// 危険レベル色情報の決定
// 外遊び危険レベル値に基づく色とレベルの決定（年齢別基準対応）
function getWbgtColorInfo(wbgtValue, ageGroup) {
    // 年齢別の閾値（バックエンドと同じ基準・危険レベル3段階）
    const thresholds = {
        "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険レベル1": 25, "高危険レベル2": 28, "非常に危険レベル3": 31},
        "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険レベル1": 26, "高危険レベル2": 29, "非常に危険レベル3": 32},
        "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険レベル1": 27, "高危険レベル2": 30, "非常に危険レベル3": 33}
    };
    
    // デフォルトは2-3歳の基準を使用
    const currentThresholds = thresholds[ageGroup] || thresholds["2-3"];
    
            if (wbgtValue >= currentThresholds["非常に危険レベル3"]) {
    return {
        level: '非常に危険レベル3',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #740303, #5a0202)', 
        progressColor: '#740303', // 最高危険の色
        textColor: 'white'
    };
    } else if (wbgtValue >= currentThresholds["高危険レベル2"]) {
    return {
        level: '高危険レベル2',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #E53E3E, #B22222)', 
        progressColor: '#E53E3E', // ワインレッド
        textColor: 'white'
    };
    } else if (wbgtValue >= currentThresholds["危険レベル1"]) {
    return {
        level: '危険レベル1',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #FF6B6B, #C53030)', 
        progressColor: '#FF6B6B', // 危険の赤
        textColor: 'white'
    };
    } else if (wbgtValue >= currentThresholds["厳重警戒"]) {
    return {
        level: '厳重警戒',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #FF8C42, #FF7A00)', 
        progressColor: '#FF8C42', // 厳重警戒のオレンジ
        textColor: 'white'
    };
    } else if (wbgtValue >= currentThresholds["警戒"]) {
    return {
        level: '警戒',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #FFEB3B, #FDD835)', 
        progressColor: '#FFEB3B', // 警戒のオレンジ
        textColor: 'white'
    };
    } else if (wbgtValue >= currentThresholds["注意"]) {
    return {
        level: '注意',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #87CEEB, #87CEEB)', 
        progressColor: '#87CEEB', // 注意の水色
        textColor: '#333'
    };
    } else {
    return {
        level: 'ほぼ安全',
        icon: '',
        bgGradient: 'linear-gradient(135deg, #2196F3, #1976D2)', 
        progressColor: '#2196F3', // ほぼ安全の青色
        textColor: 'white'
    };
    }
}

const colorInfo = getWbgtColorInfo(displayWbgtValue, targetAgeGroup);

// カラーバーの作成と更新
// 危険レベルを視覚的に表示するカラーバーを生成します
function createColorBar(wbgtValue, ageGroup) {
  // 現在のリスクレベルを取得
  const currentLevel = getWbgtColorInfo(wbgtValue, ageGroup).level;
  
  // 危険度に応じたカラーバーの強調表示
  // 現在の危険レベルに応じてカラーバーの色を調整します
  function getEnhancedColorSegments(ageGroup, currentLevel) {
    const baseColors = {
      '0-1': [
        { color: '#87CEEB', width: 18, level: '注意' },    
        { color: '#FFB74D', width: 18, level: '警戒' },    
        { color: '#FF8C42', width: 18, level: '厳重警戒' }, 
        { color: '#FF6B6B', width: 17, level: '危険レベル1' },
        { color: '#E53E3E', width: 16, level: '危険レベル2' },
        { color: '#740303', width: 13, level: '危険レベル3' }
      ],
      '2-3': [
        { color: '#87CEEB', width: 18, level: '注意' },    
        { color: '#FFB74D', width: 18, level: '警戒' },    
        { color: '#FF8C42', width: 18, level: '厳重警戒' }, 
        { color: '#FF6B6B', width: 17, level: '危険レベル1' },
        { color: '#E53E3E', width: 16, level: '危険レベル2' },
        { color: '#740303', width: 13, level: '危険レベル3' }
      ],
      '4-6': [
        { color: '#87CEEB', width: 18, level: '注意' },    
        { color: '#FFB74D', width: 18, level: '警戒' },    
        { color: '#FF8C42', width: 18, level: '厳重警戒' }, 
        { color: '#FF6B6B', width: 17, level: '危険レベル1' },
        { color: '#E53E3E', width: 16, level: '危険レベル2' },
        { color: '#740303', width: 13, level: '危険レベル3' }
      ]
    };

    const segments = baseColors[ageGroup] || baseColors['2-3'];
    
    // 現在のレベルに応じて色を強調
    return segments.map(segment => {
      let enhancedColor = segment.color;
      let extraStyle = '';
      
      // 危険レベルの判定（浮き出る効果なし）
      if (currentLevel.includes('危険') && segment.level.includes('危険')) {
        enhancedColor = segment.color;
        extraStyle = '';
      } else if (currentLevel === '厳重警戒' && segment.level === '厳重警戒') {
        enhancedColor = '#FF6B00'; // より鮮やかなオレンジ
        extraStyle = '';
      } else if (currentLevel === '警戒' && segment.level === '警戒') {
        enhancedColor = '#FF9500'; // より鮮やかなオレンジ
        extraStyle = '';
      } else if (currentLevel === '注意' && segment.level === '注意') {
        enhancedColor = '#FFD700'; // より鮮やかな黄色
        extraStyle = '';
      }
      
      return {
        color: enhancedColor,
        width: segment.width,
        level: segment.level,
        style: extraStyle
      };
    });
  }

  const enhancedSegments = getEnhancedColorSegments(ageGroup, currentLevel);
  const segmentHtml = enhancedSegments.map(segment => 
    `<div style="background-color: ${segment.color}; width: ${segment.width}%; height: 100%; flex-shrink: 0; ${segment.style}"></div>`
  ).join('');

  // 危険度に応じたカラーバー全体のスタイル
  let containerExtraClass = '';
  let titleIcon = '';
  
  if (currentLevel.includes('危険')) {
    containerExtraClass = 'danger-level';
    titleIcon = '';
  } else if (currentLevel === '厳重警戒') {
    containerExtraClass = 'severe-level'; 
    titleIcon = '';
  } else if (currentLevel === '警戒') {
    containerExtraClass = 'warning-level';
    titleIcon = '';
  }

  // 年齢別の基準値を取得
  const thresholds = {
    "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険レベル1": 25, "高危険レベル2": 28, "非常に危険レベル3": 31},
    "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険レベル1": 26, "高危険レベル2": 29, "非常に危険レベル3": 32},
    "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険レベル1": 27, "高危険レベル2": 30, "非常に危険レベル3": 33}
  };
  
  const currentThresholds = thresholds[ageGroup] || thresholds["2-3"];

  const colorBarHtml = `
    <div class="wbgt-color-bar ${containerExtraClass}">
      <div class="color-bar-title">
                        外遊び危険レベル (${ageGroup}歳)
      </div>
      <div class="color-bar-container-segments age-${ageGroup} ${containerExtraClass}">
        ${segmentHtml}
        <div class="color-bar-marker" id="colorBarMarker"></div>
      </div>
      <div class="color-bar-labels" style="position: relative; height: 30px;">
        <span style="position: absolute; left: 1%; transform: translateX(-50%); text-align: center;">注意<br>${currentThresholds["注意"]}</span>
        <span style="position: absolute; left: 18%; transform: translateX(-50%); text-align: center;">警戒<br>${currentThresholds["警戒"]}</span>
        <span style="position: absolute; left: 36%; transform: translateX(-50%); text-align: center;">厳重警戒<br>${currentThresholds["厳重警戒"]}</span>
        <span style="position: absolute; left: 54%; transform: translateX(-50%); text-align: center;">危険1:<br>${currentThresholds["危険レベル1"]}</span>
        <span style="position: absolute; left: 72%; transform: translateX(-50%); text-align: center;">危険2:<br>${currentThresholds["高危険レベル2"]}</span>
        <span style="position: absolute; left: 91%; transform: translateX(-100%); text-align: center;">危険3:<br>${currentThresholds["非常に危険レベル3"]}</span>
      </div>

    </div>
  `;
  
  return colorBarHtml;
}

// カラーバーマーカー更新
// カラーバー上の現在値マーカーの位置と色を更新します
function updateColorBarMarker(wbgtValue, ageGroup) {
  const marker = document.getElementById('colorBarMarker');
  const valueDisplay = document.getElementById('colorBarValue');
  
  if (!marker || !valueDisplay) return;
  
  // 年齢別の閾値定義（注意から開始）
  const thresholds = {
    '0-1': { min: 16, max: 34, caution: 16, warning: 19, severe: 22, danger: 25 },
    '2-3': { min: 17, max: 35, caution: 17, warning: 20, severe: 23, danger: 26 },
    '4-6': { min: 18, max: 36, caution: 18, warning: 21, severe: 24, danger: 27 }
  };
  
  const threshold = thresholds[ageGroup] || thresholds['2-3'];
  
  // 値を表示範囲内に制限
  const clampedValue = Math.max(threshold.min, Math.min(threshold.max, wbgtValue || 0));
  
  // 位置の計算（0-100%）
  const position = ((clampedValue - threshold.min) / (threshold.max - threshold.min)) * 100;
  const clampedPosition = Math.max(2, Math.min(98, position)); // マーカーが端に隠れないよう調整
  
  // マーカーの位置を更新
  marker.style.left = `${clampedPosition}%`;
  
  // 値の表示を更新
  valueDisplay.textContent = wbgtValue !== null ? `${wbgtValue.toFixed(1)}°C` : '-- °C';
  
  // マーカーの色をリスクレベルに応じて変更（アプリの実際の色に合わせる）
  const colorMapping = {
    'ほぼ安全': '#2196F3',           // アプリと同じ
    '注意': '#87CEEB',           // アプリと同じ明るい黄色
    '警戒': '#FFB74D',           // アプリと同じオレンジ
    '厳重警戒': '#FF8C42',       // アプリと同じ濃いオレンジ
    '危険レベル1': '#FF6B6B',    // アプリと同じ赤
    '高危険レベル2': '#E53E3E',  // アプリと同じワインレッド
    '非常に危険レベル3': '#740303' // アプリと同じ暗い赤
  };
  
  marker.style.borderColor = colorMapping[colorInfo.level] || '#333';
  
  // マーカーのアニメーション（無効化）
  marker.style.transform = `translateX(-50%)`;
  // アニメーション効果を削除
}

        outputDiv.innerHTML = `
    <!-- 円形プログレスバー付きメイン表示 -->
    <div style="text-align: center; background: ${colorInfo.bgGradient}; border-radius: 20px; padding: 40px 20px; margin-bottom: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); position: relative; overflow: hidden;">
    <!-- 背景装飾 -->
    <div style="position: absolute; top: -50px; right: -50px; width: 100px; height: 100px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
    <div style="position: absolute; bottom: -30px; left: -30px; width: 60px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 50%;"></div>
    
    <!-- 円形プログレスバー -->
    <div class="circular-progress-container" style="position: relative; width: 140px; height: 140px; margin: 0 auto 20px auto;">
        <svg style="width: 140px; height: 140px;" class="circular-progress-svg circular-progress-animation">
        <!-- SVGグラデーション定義 -->
        <defs>
            <!-- 進行度別の単色グラデーション定義（カラーバーの色に対応） -->
            <linearGradient id="safeProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#2196F3;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="cautionProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#87CEEB;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#87CEEB;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="warningProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#FFB74D;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#FFB74D;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="severeProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#FF8C42;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#FF8C42;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="dangerProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#FF6B6B;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#FF6B6B;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="highDangerProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#E53E3E;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#E53E3E;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="extremeDangerProgressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#740303;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#740303;stop-opacity:1" />
            </linearGradient>
            <!-- 連続カラーバーと一致させる円形プログレスバー用グラデーション（6時＝青→水色→オレンジ→赤） -->
            <linearGradient id="circularProgressGradient" x1="50%" y1="90%" x2="0%" y2="90%" gradientUnits="objectBoundingBox">
                <stop offset="0%"   style="stop-color:#2196F3;stop-opacity:1" />  <!-- 青（ほぼ安全） -->
                <stop offset="33%"  style="stop-color:#87CEEB;stop-opacity:1" />  <!-- 水色（注意） -->
                <stop offset="66%"  style="stop-color:#FFB74D;stop-opacity:1" />  <!-- オレンジ（警戒） -->
                <stop offset="100%" style="stop-color:#FF6B6B;stop-opacity:1" />  <!-- 赤（危険） -->
            </linearGradient>
            
            <!-- 放射状グラデーション（代替案）：中心から外側に向かって色が変化 -->
            <radialGradient id="radialProgressGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   style="stop-color:#2196F3;stop-opacity:1" />  <!-- 青（ほぼ安全） -->
                <stop offset="25%"  style="stop-color:#87CEEB;stop-opacity:1" />  <!-- 水色（注意） -->
                <stop offset="50%"  style="stop-color:#FFB74D;stop-opacity:1" />  <!-- オレンジ（警戒） -->
                <stop offset="75%"  style="stop-color:#FF8C42;stop-opacity:1" />  <!-- 濃いオレンジ（厳重警戒） -->
                <stop offset="100%" style="stop-color:#FF6B6B;stop-opacity:1" />  <!-- 赤（危険） -->
            </radialGradient>
        </defs>
        <!-- 背景円 -->
        <circle cx="70" cy="70" r="60" fill="none" stroke="${getProgressBackgroundColor(colorInfo.level)}" stroke-width="12"/>
        <!-- プログレス円（危険度別グラデーション） -->
        <circle cx="70" cy="70" r="60" fill="none" stroke="${getProgressStroke(colorInfo.level, colorInfo.progressColor)}" stroke-width="12" 
                stroke-linecap="round" 
                stroke-dasharray="${2 * Math.PI * 60}" 
                stroke-dashoffset="${2 * Math.PI * 60 * (1 - progressPercentage / 100)}"
                transform="rotate(180 70 70)"
                style="transition: stroke-dashoffset 1.5s ease-out, stroke 0.5s ease-in-out;"/>
        </svg>
        
        <!-- 中央の数値表示 -->
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: ${colorInfo.textColor};">
        <div style="font-size: ${colorInfo.level.includes('危険') || colorInfo.level === '厳重警戒' ? '64px' : '48px'}; font-weight: 700; line-height: 1; margin-bottom: 4px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
            ${displayWbgtValue}
        </div>
        </div>
    </div>
    
    <!-- ステータス表示 -->
    <div style="color: ${colorInfo.textColor}; font-size: ${colorInfo.level === '危険' || colorInfo.level === '厳重警戒' ? '24px' : '18px'}; font-weight: 700; margin-bottom: 8px; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
        ${colorInfo.level}
    </div>
    <div style="color: ${colorInfo.textColor}; opacity: 0.9; font-size: ${colorInfo.level === '危険' || colorInfo.level === '厳重警戒' ? '16px' : '14px'}; font-weight: 500;">
                        外遊び危険レベル
    </div>
    </div>
    
    <!-- カラーバー -->
    ${createColorBar(displayWbgtValue, targetAgeGroup)}
    
    <!-- AIメッセージ／画像解析結果カード -->
    ${data.comparison_analysis || data.image_analysis ? `
    <!-- 画像解析結果（画像がある場合はこちらのみ表示） -->
    <div style="background: ${colorInfo.bgGradient.replace('135deg', '145deg')}; border: 2px solid ${colorInfo.level === '危険' ? '#C53030' : colorInfo.level === '厳重警戒' ? '#FF7A00' : colorInfo.level === '警戒' ? '#FF9800' : colorInfo.level === '注意' ? '#87CEEB' : '#2196F3'}; border-radius: 16px; padding: 20px; margin-bottom: 20px; position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.15); opacity: 0.95;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: ${colorInfo.textColor};">
        ${data.comparison_analysis ? '外出前後差分分析' : '画像解析結果'}
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: ${colorInfo.textColor}; text-shadow: ${colorInfo.textColor === 'white' ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'};">
        ${formatAiMessageWithBullets(data.comparison_analysis?.ai_analysis || data.image_analysis?.ai_analysis || '画像データから追加の分析結果が得られました。')}
        </div>
    </div>
    ` : `
    <!-- AIメッセージカード（画像がない場合のみ表示） -->
    <div style="background: ${colorInfo.bgGradient.replace('135deg', '145deg')}; border: 2px solid ${colorInfo.level === '危険' ? '#C53030' : colorInfo.level === '厳重警戒' ? '#FF7A00' : colorInfo.level === '警戒' ? '#FF9800' : colorInfo.level === '注意' ? '#87CEEB' : '#2196F3'}; border-radius: 16px; padding: 20px; margin-bottom: 20px; position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.15); opacity: 0.95;">
        <!-- メッセージ内容 -->
        <div style="font-size: 16px; line-height: 1.6; color: ${colorInfo.textColor}; font-weight: 500; text-shadow: ${colorInfo.textColor === 'white' ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'};">
            ${formatAiMessageWithBullets(ageGroupAnalysis.ai_advice || `${targetAgeGroup === '0-1' ? '0-1歳さん' : targetAgeGroup === '2-3' ? '2-3歳さん' : '4-6歳さん'}、今日の外遊び危険レベルは「${colorInfo.level}」です。こまめな水分補給と適度な休憩を心がけて、ほぼ安全に過ごしましょう。`)}
        </div>
    </div>
    `}
    
    <!-- 環境情報カード -->
    <div style="background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
        今の暑さ（気象庁アメダス観測データ）
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.station || '練馬'}</div>
        <div style="font-size: 12px; color: #666;">観測所</div>
        </div>
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.time ? observation.time.replace(' JST', '').replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}).*/, '$2/$3 $4') : new Date().toLocaleDateString('ja-JP', {month: 'numeric', day: 'numeric'}) + ' ' + new Date().toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</div>
        <div style="font-size: 12px; color: #666;">観測日時</div>
        </div>
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.temperature !== null && observation.temperature !== undefined ? observation.temperature + '°C' : '20°C'}</div>
        <div style="font-size: 12px; color: #666;">気温</div>
        </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.humidity !== null && observation.humidity !== undefined ? observation.humidity + '%' : '60%'}</div>
        <div style="font-size: 12px; color: #666;">湿度</div>
        </div>
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.wind_speed !== null && observation.wind_speed !== undefined ? observation.wind_speed + 'm/s' : '0.5m/s'}</div>
        <div style="font-size: 12px; color: #666;">風速</div>
        </div>
        <div style="text-align: center;">
        <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">${observation.solar_radiation !== null && observation.solar_radiation !== undefined ? observation.solar_radiation : '--'}</div>
        <div style="font-size: 12px; color: #666;">日射量</div>
        </div>
    </div>
    
    <!-- 地面の温度 -->
    <div style="border-top: 1px solid #f0f0f0; padding-top: 16px;">
        <div style="font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px;">地面の温度（晴れた日中の推定値）</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
            ${data.child_temperature_analysis?.ground_temperatures?.normal_ground ? Math.round(data.child_temperature_analysis.ground_temperatures.normal_ground) + '°C' : '29°C'}
            </div>
            <div style="font-size: 12px; color: #666;">土・芝生・<br>コンクリート</div>
        </div>
        <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
            ${data.child_temperature_analysis?.ground_temperatures?.asphalt ? Math.round(data.child_temperature_analysis.ground_temperatures.asphalt) + '°C' : '36°C'}
            </div>
            <div style="font-size: 12px; color: #666;">アスファルト・<br>駐車場</div>
        </div>
        </div>
    </div>
    </div>
    
    <!-- お子さまが感じる暑さカード -->
    <div style="background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
            お子さまが感じる暑さ(推定値)
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div style="text-align: center;">
                <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
                    ${(() => {
                        // API から取得した計算結果を使用（重複計算を回避）
                        const childTemp = data.child_temperature_analysis?.child_temperatures;
                        if (childTemp?.child_feels_like_min && childTemp?.child_feels_like_max) {
                            return Math.round(childTemp.child_feels_like_min) + '°C～' + Math.round(childTemp.child_feels_like_max) + '°C';
                        }
                        // フォールバック（APIデータがない場合）
                        const baseTemp = observation.temperature || 25;
                        const ageAdjustments = {
                            '0-1': { min: 5, max: 8 },
                            '2-3': { min: 4, max: 7 },
                            '4-6': { min: 3, max: 6 }
                        };
                        const adjustment = ageAdjustments[targetAgeGroup] || ageAdjustments['2-3'];
                        return Math.round(baseTemp + adjustment.min) + '°C～' + Math.round(baseTemp + adjustment.max) + '°C';
                    })()}
                </div>
                <div style="font-size: 12px; color: #666;">お子さまの体感温度</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
                    ${(() => {
                        // API から取得した計算結果を使用（重複計算を回避）
                        const correctionRange = data.child_temperature_analysis?.child_temperatures?.correction_range;
                        if (correctionRange?.min && correctionRange?.max) {
                            return '+' + correctionRange.min + '℃～+' + correctionRange.max + '℃';
                        }
                        // フォールバック（APIデータがない場合）
                        const ageAdjustments = {
                            '0-1': { min: 5, max: 8 },    
                            '2-3': { min: 4, max: 7 },   
                            '4-6': { min: 3, max: 6 }   
                        };
                        const adjustment = ageAdjustments[targetAgeGroup] || ageAdjustments['2-3'];
                        return '+' + adjustment.min + '℃～+' + adjustment.max + '℃';
                    })()}
                </div>
                <div style="font-size: 12px; color: #666;">大人との差</div>
            </div>
        </div>
        
        <!-- 車内・お散歩カート温度 -->
        <div style="border-top: 1px solid #f0f0f0; padding-top: 16px;">
            <div style="font-size: 14px; font-weight: 600; color: #333; margin-bottom: 8px;">車内・お散歩カートの温度（晴れた日中の推定値）</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div style="text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
                        ${(() => {
                            // API から取得した計算結果を使用（重複計算を回避）
                            const carTemp = data.child_temperature_analysis?.child_temperatures?.car_interior_temp;
                            if (carTemp) {
                                return Math.round(carTemp) + '°C';
                            }
                            // フォールバック
                            return Math.round((observation.temperature || 25) + 15) + '°C';
                        })()}
                    </div>
                    <div style="font-size: 12px; color: #666;">車内温度<br>（日向駐車時）</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 4px;">
                        ${(() => {
                            // API から取得した計算結果を使用（重複計算を回避）
                            const strollerTemp = data.child_temperature_analysis?.child_temperatures?.stroller_temp;
                            if (strollerTemp) {
                                return Math.round(strollerTemp) + '°C';
                            }
                            // フォールバック
                            return Math.round((observation.temperature || 25) + 7) + '°C';
                        })()}
                    </div>
                    <div style="font-size: 12px; color: #666;">お散歩カート(ベビーカー)内<br>（風通し悪い）</div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- 年齢別対策カード -->
    <div style="background: white; border-radius: 16px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="font-size: 16px; font-weight: 600; color: #333; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
            年齢別対策
        </div>
        
        <!-- 年齢別対策の内容 -->
        <div id="ageSpecificGuidance">
            ${getAgeSpecificGuidance(targetAgeGroup)}
        </div>
    </div>
    

    
    <!-- AIアドバイスカード（削除：現在の環境の上のAIメッセージカードと重複のため） -->
`;

// カード形式で一括表示（段階的表示なし）

// カラーバーのマーカー位置を更新
setTimeout(() => {
    updateColorBarMarker(displayWbgtValue, targetAgeGroup);
}, 100);
}

// ページ読み込み時に自動実行（オプション）
// window.addEventListener('load', function() {
//   document.getElementById('fetchButton').click();
// });