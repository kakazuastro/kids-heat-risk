# =============================================================================
# 【1. 必要なライブラリをインポート】
# Webサービスや日時処理、AI機能に必要なツールを読み込みます
# =============================================================================
import functions_framework  # Google Cloud Functionsで動かすために必要
import requests             # 気象庁のデータを取得するために必要
import math                # 数学計算用
import json                # データ形式の変換用
from datetime import datetime, timezone, timedelta  # 日時の処理用
import random              # ランダムな値の生成用
import os                  # 環境変数を読み取るために必要
import google.generativeai as genai  # Google のAIを使うために必要
import concurrent.futures  # AI処理を時間制限付きで実行するために必要
import time               # 処理時間の測定用
import base64             # 画像データの変換用
import os

'''
【このプログラムの全体概要】
子供向け熱中症予防システム（Google Cloud Functions版）
- 気象庁のデータから暑さ指数(WBGT)を計算
- Gemini AIを使って年齢に応じたアドバイスを自動生成
- 画像解析で危険度を判定
- タイムアウト機能で素早いレスポンスを保証
'''

# =============================================================================
# 【2. 基本設定値の定義】
# アプリで使用するデフォルト値やAPIキーを設定します
# =============================================================================
STATION_ID = "44071"  # 気象観測所のID（デフォルトは練馬）
STATION_NAME = "練馬"   # 気象観測所の名前

# AI処理のタイムアウト設定（秒）
# AIが応答しない場合の待機時間の上限を設定
AI_TIMEOUT_SECONDS = 15          # 全体的なタイムアウト
AI_ADVICE_TIMEOUT = 12          # アドバイス生成のタイムアウト
AI_RECOMMENDATIONS_TIMEOUT = 12   # 推奨事項生成のタイムアウト
AI_VISION_TIMEOUT = 15           # 画像解析のタイムアウト

# =============================================================================
# 【3. Gemini AIの初期設定】
# Google のAIサービスに接続するための準備を行います
# =============================================================================
# 環境変数からAPIキーを取得（本番環境用）
# 環境変数が無い場合はNoneとなる
GEMINI_API_KEY = os.environ.get('API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)  # AIサービスの初期化

# =============================================================================
# 【4. AIアドバイス生成機能】
# 子供の年齢や気象状況に応じて、個別化されたアドバイスをAIが自動生成します
# =============================================================================
def generate_ai_advice(wbgt, age_group, temperature, humidity, risk_level, context_data=None, timeout=AI_ADVICE_TIMEOUT):
    """
    【機能説明】
    Gemini AIを使って、その子の年齢と今の天気に合わせた
    熱中症予防のアドバイスを自動で作ってくれる機能
    
    【入力データ】
    wbgt : 今の暑さ指数（暑さの度合いを表す数値）
    age_group : 子供の年齢グループ ("0-1歳", "2-3歳", "4-6歳")
    temperature : 現在の気温（℃）
    humidity : 現在の湿度（%）
    risk_level : 危険レベル（"ほぼ安全"から"危険"まで）
    context_data : その他の追加情報（オプション）
    timeout : AIの応答待ち時間の上限（秒）
    
    【出力データ】
    result: 生成されたアドバイス文章
    ai_generated: AIが作ったかどうか（True/False）
    processing_time: 処理にかかった時間
    status: 処理の成功/失敗の状況
    """
    start_time = time.time()  # 処理時間測定開始
    
    # =============================================================================
    # 【4-1. 緊急時用のメッセージを準備】
    # AIが使えない時や時間がかかりすぎる時用の、予め用意されたアドバイス
    # =============================================================================
    fallback_messages = {
        "0-1": {
            "ほぼ安全": "乳児も安心して過ごせます。15分間隔で様子観察が大切です。授乳による水分補給を心がけてください。",
            "注意": "5-10分に一度は様子確認を。体温チェックが重要です。頻繁な水分補給を行いましょう。",
            "警戒": "短時間の外出のみ推奨。保育者の継続的な観察が必須です。10分以内の活動に留めてください。",
            "厳重警戒": "外出は最小限に。室内で涼しく過ごしましょう。5分以内の短時間活動を推奨します。",
            "危険レベル1": "外出中止を強く推奨。室内で涼しい環境を保ちます。こまめな体調確認をしてください。",
            "高危険レベル2": "完全屋内待機。エアコン必須で体温管理を徹底してください。医療機関への相談も検討しましょう。",
            "非常に危険レベル3": "緊急レベル。完全屋内待機でエアコン稼働必須。少しでも異変があれば即座に医療機関へ。"
        },
        "2-3": {
            "ほぼ安全": "安心して遊べます。本人の様子をよく観察します。15-30分間隔で水分補給を促しましょう。",
            "注意": "15分に一度は水分補給の声かけを。体調変化を注意深く観察してください。日陰での休憩も大切です。",
            "警戒": "こまめな水分補給と休憩を。体調の変化に敏感に対応します。20分以内の活動にしましょう。",
            "厳重警戒": "短時間の外遊びのみ。帽子・日陰必須です。本人の訴えを注意深く聞きます。15分以内を推奨します。",
            "危険レベル1": "外遊び中止を推奨。室内活動を優先します。異変があればすぐに対応してください。",
            "高危険レベル2": "完全屋内活動。エアコンで涼しく保ち、水分補給を強化してください。体調変化に最大限注意を。",
            "非常に危険レベル3": "緊急レベル。屋外活動完全禁止。エアコン稼働で体温管理を徹底し、医療機関への相談を検討してください。"
        },
        "4-6": {
            "ほぼ安全": "元気に遊べます。のどが渇いたら言うように教えます。30分間隔で水分補給を促しましょう。",
            "注意": "20-30分に一度は水分補給を。体調について聞いてあげます。適度な休憩を取りましょう。",
            "警戒": "こまめな水分補給と休憩を。体調の変化を自分で伝えるよう促します。適切な対策を心がけてください。",
            "厳重警戒": "外遊びは短時間に。体調不良の兆候を伝えるよう教えます。30分以内の活動を推奨します。",
            "危険レベル1": "屋外での活動は中止。自分の体調変化を大人に伝える練習をします。室内で過ごしましょう。",
            "高危険レベル2": "完全屋内活動。エアコンで涼しく保ち、体調の変化を積極的に伝えるよう指導してください。",
            "非常に危険レベル3": "緊急レベル。屋外活動完全禁止。体調不良時の症状を教え、異変時は即座に大人に伝えるよう徹底してください。"
        }
    }
    
    # 年齢グループと危険レベルに応じたメッセージを選択
    fallback_message = fallback_messages.get(age_group, fallback_messages["2-3"]).get(risk_level, "適切な対策を心がけてください")
    
    # =============================================================================
    # 【4-2. AIが使えるかチェック】
    # APIキーが設定されていない場合は、すぐに固定メッセージを返す
    # =============================================================================
    if not GEMINI_API_KEY:
        return {
            "result": fallback_message,
            "ai_generated": False,
            "processing_time": time.time() - start_time,
            "status": "fallback_no_api_key"
        }
    
    # =============================================================================
    # 【4-3. AI処理の実行部分】
    # 実際にGemini AIにアドバイス生成を依頼する処理
    # =============================================================================
    def ai_advice_worker():
        try:
            # 年齢グループに応じた説明
            age_descriptions = {
                "0-1": "0-1歳の乳児（身長約0.6-0.8m、自身の体調について伝えることができない、最も地面に近く暑さの影響を強く受ける）",
                "2-3": "2-3歳の幼児（身長約0.8-1.0m、言葉は覚えるが体調が悪くなりそうなど前兆がわからない、経験が乏しい）",
                "4-6": "4-6歳の幼児・園児（身長約1.0-1.2m、ある程度自分のことを伝えられるようになる）"
            }
            
            # 現在の時刻を取得
            current_time = datetime.now(timezone.utc)
            current_time = current_time.astimezone(timezone(timedelta(hours=9)))  # JSTに変換
            time_context = ""
            if 6 <= current_time.hour <= 10:
                time_context = "朝の時間帯"
            elif 10 <= current_time.hour <= 14:
                time_context = "日中の最も暑い時間帯"
            elif 14 <= current_time.hour <= 18:
                time_context = "午後の時間帯"
            else:
                time_context = "夜間"

            # 危険レベル別の詳細指示を含むプロンプト
            risk_level_guidance = {
                "非常に危険レベル3": {
                    "water": "子ども用コップ（150-200ml）で4-5杯、10-15分間隔で強制的に摂取",
                    "aircon": "22-24℃に即座に調整し、エアコンをフル稼働",
                    "check": "顔色や元気さを3-5分ごとに厳重チェック",
                    "adult": "大人が40-45℃相当の極度の暑さを感じる非常に危険な状況"
                },
                "高危険レベル2": {
                    "water": "子ども用コップ（150-200ml）で3-4杯、15-20分間隔で積極的に摂取",
                    "aircon": "24-26℃に調整し、エアコンを強めに設定",
                    "check": "顔色や元気さを5-10分ごとに頻繁チェック",
                    "adult": "大人が35-40℃相当の強い暑さを感じる危険な状況"
                },
                "危険レベル1": {
                    "water": "子ども用コップ（150-200ml）で2-3杯、20-30分間隔で定期摂取",
                    "aircon": "26-27℃に調整し、エアコンを適切に設定",
                    "check": "顔色や元気さを10-15分ごとに定期チェック",
                    "adult": "大人が30-35℃相当の暑さを感じる注意が必要な状況"
                }
            }
            
            # リスクレベルに応じた指示を取得
            current_guidance = risk_level_guidance.get(risk_level, risk_level_guidance["危険レベル1"])
            
            prompt = f"""
子どもの熱中症予防専門家として、以下の状況に基づいて実用的なアドバイスを生成してください。

【状況】
- 暑さ指数(WBGT): {wbgt}℃
- 気温: {temperature}℃、湿度: {humidity}%
- リスク: {risk_level}
- 対象: {age_descriptions.get(age_group, age_group)}
- 時間: {time_context}

【要件】
水分補給、空調設定、体調確認、行動制限の4つの観点で、年齢に応じた具体的な行動指針を提供してください。
具体的な時間や頻度を含め、箇条書きと適切に改行を入れて視覚的に分かりやすく記述してください。

【出力形式】
〇水分補給
子ども用コップ（150-200ml）で○杯
*分間隔で定期的に摂取

〇空調設定
*℃設定推奨
エアコンの風の向きや扇風機の使用について

〇体調確認
顔色、汗の量、呼吸の様子などを*分おきに確認
注意すべき症状について

〇行動制限
外出時間の制限（*時間以内など）
活動場所の推奨（室内・日陰など）
避けるべき行動について

上記の形式で、現在の状況に最適なアドバイスを生成してください。挨拶や説明は不要です。"""

            # Gemini APIを呼び出し（最も安価なモデルを使用）
            model = genai.GenerativeModel('gemini-2.0-flash-lite')
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=250,  # 出力を増やして完全なアドバイスを取得
                    temperature=0.7
                )
            )
            
            if response.text:
                return response.text.strip()
            else:
                return None
                
        except Exception as e:
            print(f"Gemini API呼び出しエラー: {e}")
            return None
    
    # =============================================================================
    # 【4-4. 時間制限付きでAI処理を実行】
    # AIの応答が遅い場合は諦めて、固定メッセージを返す仕組み
    # =============================================================================
    try:
        # AIの処理を別スレッドで実行（時間制限付き）
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(ai_advice_worker)  # AI処理を開始
            try:
                # 指定時間内にAIから結果を取得
                ai_result = future.result(timeout=timeout)
                
                if ai_result:  # AIが正常に応答した場合
                    return {
                        "result": ai_result,
                        "ai_generated": True,
                        "processing_time": time.time() - start_time,
                        "status": "success"
                    }
                else:  # AIが失敗した場合
                    return {
                        "result": fallback_message,
                        "ai_generated": False,
                        "processing_time": time.time() - start_time,
                        "status": "ai_failed"
                    }
                    
            except concurrent.futures.TimeoutError:  # 時間切れの場合
                print(f"AI アドバイス生成がタイムアウトしました（{timeout}秒）")
                return {
                    "result": fallback_message,
                    "ai_generated": False,
                    "processing_time": timeout,
                    "status": "timeout"
                }
            
    except Exception as e:  # その他のエラーが発生した場合
        print(f"AI アドバイス生成で予期しないエラー: {e}")
        return {
            "result": fallback_message,
            "ai_generated": False,
            "processing_time": time.time() - start_time,
            "status": "error"
        }

# =============================================================================
# 【5. 詳細推奨事項生成機能】
# 基本的なアドバイスに加えて、より詳しい推奨事項をAIが自動生成します
# =============================================================================
def generate_detailed_recommendations(wbgt, age_group, temperature, humidity, risk_level, weather_data, timeout=AI_RECOMMENDATIONS_TIMEOUT):
    """
    【機能説明】
    基本的なアドバイスに加えて、より詳しい推奨事項を
    AIが年齢と気象状況に合わせて自動生成する機能
    """
    start_time = time.time()
    
    # フォールバック：固定の推奨事項
    fallback_general = [
        "十分な水分を、15分〜30分間隔で確認",
        "適度な休憩と日陰の利用",
        "帽子や日傘で直射日光を避ける",
        "通気性の良い服装を選ぶ"
    ]
    
    fallback_age_specific = {
        "0-1": ["保育者による継続的な観察（5分ごと）", "極短時間の外出（5-10分以内）", "室内での活動を最優先", "授乳・水分補給の頻度を増やす"],
        "2-3": ["保育者による頻繁な様子確認（10-15分ごと）", "体調の変化を注意深く観察", "水分補給の積極的な声かけ", "涼しい時間帯の活動推奨"],
        "4-6": ["体調の変化を自分で伝える練習", "のどの渇きを感じたら伝えるよう指導", "水分補給のタイミングを教える", "体調不良のサインを教える"]
    }
    
    fallback_result = {
        "general": fallback_general,
        "age_specific": fallback_age_specific.get(age_group, fallback_age_specific["2-3"]),
        "ai_generated": False,
        "processing_time": time.time() - start_time,
        "status": "fallback"
    }
    
    if not GEMINI_API_KEY:
        fallback_result["status"] = "fallback_no_api_key"
        return fallback_result
    
    def recommendations_worker():
        try:
            # 改善されたプロンプト（JSONのみ出力）
            prompt = f"""
{{
    "general": ["十分な水分補給を心がける", "こまめな休憩を取る", "涼しい服装を選ぶ", "日陰を利用する"],
    "age_specific": ["保護者による頻繁な確認", "短時間の外出に留める", "室内での活動を優先"]
}}

上記の形式で、WBGT{wbgt}℃、リスク{risk_level}、年齢{age_group}歳の状況に応じた推奨事項をJSONで出力してください。説明文は不要です。"""

            model = genai.GenerativeModel('gemini-2.0-flash-lite')
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=300,  # 出力を制限
                    temperature=0.5
                )
            )
            
            if response.text:
                try:
                    # JSONパースを試行
                    import re
                    json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
                    if json_match:
                        recommendations = json.loads(json_match.group())
                        return recommendations
                except:
                    pass
            
            return None
            
        except Exception as e:
            print(f"詳細推奨事項生成エラー: {e}")
            return None
    
    try:
        # タイムアウト付きでAI処理を実行
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(recommendations_worker)
            try:
                ai_result = future.result(timeout=timeout)
                if ai_result and isinstance(ai_result, dict) and "general" in ai_result:
                    ai_result.update({
                        "ai_generated": True,
                        "processing_time": time.time() - start_time,
                        "status": "success"
                    })
                    return ai_result
                else:
                    fallback_result["status"] = "ai_failed"
                    return fallback_result
                    
            except concurrent.futures.TimeoutError:
                print(f"AI 推奨事項生成がタイムアウトしました（{timeout}秒）")
                fallback_result["status"] = "timeout"
                fallback_result["processing_time"] = timeout
                return fallback_result
                
    except Exception as e:
        print(f"AI 推奨事項生成で予期しないエラー: {e}")
        fallback_result["status"] = "error"
        fallback_result["processing_time"] = time.time() - start_time
        return fallback_result

# =============================================================================
# 【6. 暑さ指数(WBGT)計算機能】
# 環境省の公式計算式を使って、今の気象状況から暑さの危険度を数値化します
# =============================================================================
def calculate_wbgt(temp, humidity, wind_speed=None, solar_radiation=None):
    """
    【機能説明】
    環境省が定めた公式の計算式を使って「暑さ指数（WBGT）」を計算する機能
    WBGTは気温、湿度、風速、日射量から総合的な暑さの危険度を数値化したもの
    
    【公式情報】
    環境省サイト『当サイトで提供する暑さ指数について』に記載の
    小野ら(2014) 回帰式（実況推定・予測値用）を使用
    詳細: https://www.wbgt.env.go.jp/wbgt_detail.php
    
    【入力データ】
    temp            : 現在の気温            [℃]
    humidity        : 現在の湿度            [%] (0-100)
    solar_radiation : 太陽からの日射量      [MJ/m²] (気象庁から取得)
    wind_speed      : 現在の風速            [m/s]
    
    【出力データ】
    暑さ指数(WBGT) [℃] ― 小数点以下1桁まで
    
    【技術的な注意点】
    気象庁の日射量は MJ/m² 単位なので、計算式用に kW/m² に変換
    """
    # =============================================================================
    # 【6-1. 入力データの検証】
    # 気温と湿度は必須。ないと計算できないのでエラーを返す
    # =============================================================================
    if temp is None or humidity is None:
        return None
    
    # =============================================================================
    # 【6-2. 欠損データの補完】
    # 風速や日射量がない場合は、平均的な値を使って計算を続行
    # =============================================================================
    if wind_speed is None:
        wind_speed = 1.0  # 平均的な風速を設定
    if solar_radiation is None:
        solar_radiation = 2.0  # 平均的な日射量を設定 (MJ/m²)
    
    # =============================================================================
    # 【6-3. 単位の変換処理】
    # 気象庁APIの日射量 (MJ/m²) を計算式用 (kW/m²) に変換
    # =============================================================================
    # 変換式: 1 MJ/m² = 1000 kJ/m² = 1000/3600 kWh/m² ≈ 0.278 kWh/m²
    # 正確な変換係数: MJ/m² × 0.278 = kW/m²
    sr_kwm2 = solar_radiation * 0.278
    
    # 日射量がゼロの時は拡散光を考慮（夜間の月光・街灯、曇天時の散乱光）
    # 完全に暗黒ではないので、経験的に SR ≈ 0.15 kW/m² を設定
    if sr_kwm2 == 0 or solar_radiation == 0:
        sr_kwm2 = 0.15  # 拡散光の代表値 [kW/m²]
    
    # =============================================================================
    # 【6-4. 環境省公式の計算式実行】
    # 小野ら(2014) 回帰式による暑さ指数(WBGT)の計算
    # =============================================================================
    wbgt = (
        0.735  * temp +                    # 気温の影響
        0.0374 * humidity +                # 湿度の影響
        0.00292 * temp * humidity +        # 気温と湿度の相互作用
        7.619  * sr_kwm2 -                 # 日射量の影響（正の効果）
        4.557  * (sr_kwm2 ** 2) -          # 日射量の影響（負の効果）
        0.0572 * wind_speed -              # 風速の影響（冷却効果）
        4.064                              # 定数項
    )
    
    return round(wbgt, 1)  # 小数点以下1桁に丸めて返す


# =============================================================================
# 【7. 熱中症リスクレベル判定機能】
# 子供の年齢に応じて、暑さ指数から熱中症の危険度を判定します
# =============================================================================
def get_heat_risk_level(wbgt, age_group="2-3", temperature=None, humidity=None):
    """
    【機能説明】
    計算された暑さ指数(WBGT)を元に、子供の年齢に応じた
    熱中症の危険度レベルを判定し、AIアドバイスも生成する機能
    
    【重要な考え方】
    子供は大人より地面に近く、より暑い環境にいるため
    大人の基準より厳しい基準で危険度を判定する
    """
    # =============================================================================
    # 【7-1. 入力データの検証】
    # 暑さ指数がない場合はエラー情報を返す
    # =============================================================================
    if wbgt is None:
        return {"level": "不明", "color": "gray", "message": "データ不足", "ai_advice": "データが不足しているため、適切なアドバイスを提供できません。", "ai_generated": False}

    # =============================================================================
    # 【7-2. 年齢別危険度しきい値の設定】
    # 子供は大人より地面に近く、より暑い環境にいるため基準を厳しく設定
    # 体調を伝えられない年齢ほど、より厳しい基準を適用
    # =============================================================================
    thresholds = {
        # 0-1歳（乳児）：体調を伝えられないため最も厳しい基準
        "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険レベル1": 25, "高危険レベル2": 28, "非常に危険レベル3": 31},
        # 2-3歳（幼児）：経験が乏しく前兆がわからないため厳しい基準
        "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険レベル1": 26, "高危険レベル2": 29, "非常に危険レベル3": 32},
        # 4-6歳（園児）：ある程度伝えられるが地面に近いため注意が必要
        "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険レベル1": 27, "高危険レベル2": 30, "非常に危険レベル3": 33},
    }
    
        
    # =============================================================================
    # 【7-3. 年齢に応じたしきい値を選択】
    # 指定された年齢グループのしきい値を取得（デフォルトは2-3歳）
    # =============================================================================
    th = thresholds.get(age_group, thresholds["2-3"])

    # =============================================================================
    # 【7-4. 暑さ指数による危険レベルの判定】
    # 計算されたWBGT値をしきい値と比較して危険レベルを決定
    # =============================================================================
    if wbgt < th["注意"]:
        key = "ほぼ安全"
    elif wbgt < th["警戒"]:
        key = "注意"
    elif wbgt < th["厳重警戒"]:  
        key = "警戒"
    elif wbgt < th["危険レベル1"]:
        key = "厳重警戒"
    elif wbgt < th["高危険レベル2"]:
        key = "危険レベル1"
    elif wbgt < th["非常に危険レベル3"]:
        key = "高危険レベル2"
    else:
        key = "非常に危険レベル3"

    # =============================================================================
    # 【7-5. 危険レベルに応じた色の設定】
    # アプリの画面で表示する色を危険レベルに応じて設定
    # =============================================================================
    colors = {"ほぼ安全": "blue", "注意": "yellow", "警戒": "orange", "厳重警戒": "red", "危険レベル1": "#FF3300", "高危険レベル2": "#D31919", "非常に危険レベル3": "#740303"}
    
    # =============================================================================
    # 【7-6. AIによる個別アドバイス生成】
    # 判定された危険レベルと気象状況を元に、個別化されたアドバイスをAIが生成
    # =============================================================================
    ai_advice_result = generate_ai_advice(wbgt, age_group, temperature, humidity, key)
    
    return {
        "level": key, 
        "color": colors[key], 
        "message": ai_advice_result["result"],
        "ai_advice": ai_advice_result["result"],
        "ai_generated": ai_advice_result["ai_generated"],
        "ai_processing_time": ai_advice_result["processing_time"],
        "ai_status": ai_advice_result["status"],
        "traditional_message": "AI生成メッセージまたはフォールバック"
    }


# =============================================================================
# 【8. 子供の体感温度計算機能】
# 子供は大人より地面に近いため、実際に感じる暑さを計算します
# =============================================================================
def calculate_child_temperatures(temp, age_group="2-3"):
    """
    【機能説明】
    子供の身長による体感温度の違いを計算する機能
    地面に近いほど暑さを強く感じるため、年齢に応じて補正
    
    【入力データ】
    temp: 気象庁で測定された実際の気温(℃)
    age_group: 子供の年齢グループ
    """
    if temp is None:
        return None, None, None, None, None

    # 身長によって感じる暑さの違い（実際の測定結果に基づく）
    height_temp_corrections = {
        "0-1": {"min": 5.0, "max": 8.0},   # 乳児（身長約0.6-0.8m）：最も地面に近く暑さを強く感じる
        "2-3": {"min": 4.0, "max": 7.0},   # 幼児（身長約0.8-1.0m）：地面に近く暑さを感じやすい
        "4-6": {"min": 3.0, "max": 6.0}    # 幼児・園児（身長約1.0-1.2m）：地面からやや離れ影響は少なめ
    }

    # 地面の材質による温度（一般的な傾向）
    ground_temp_normal = temp + 8.0   # 普通の地面（土・芝生・コンクリート）
    ground_temp_asphalt = temp + 15.0  # アスファルト（駐車場・道路）：特に熱くなる

    # 子どもが実際に感じる暑さの範囲
    correction_range = height_temp_corrections.get(age_group, {"min": 1.0, "max": 2.0})
    child_feels_like_min = temp + correction_range["min"]
    child_feels_like_max = temp + correction_range["max"]

    return child_feels_like_min, child_feels_like_max, ground_temp_normal, ground_temp_asphalt, correction_range


# =============================================================================
# 【9. 気象庁データ取得機能】
# 気象庁のアメダス（観測網）から最新の気象データを取得します
# =============================================================================
def get_amedas_data(station_id=None, station_name=None):
    """
    【機能説明】
    気象庁のアメダス（全国の気象観測網）から最新の気象データを取得する機能
    暑さ指数の計算に必要な気温、湿度、風速、日射量を取得
    
    【入力データ】
    station_id : 観測所のID番号（例：練馬は"44071"）
    station_name : 観測所の名前（例：「練馬」）
    
    【出力データ（辞書形式）】
    - station: 観測地点名
    - station_id: 観測地点ID
    - time: 観測日時
    - temperature: 気温 [℃]
    - humidity: 相対湿度 [%]
    - wind_speed: 平均風速 [m/s]
    - solar_radiation: 全天日射量 [MJ/m²] ※WBGT計算用
    - sunshine: 表示用（互換性のため）
    """
    # =============================================================================
    # 【9-1. 処理開始のデバッグ情報出力】
    # どの観測所のデータを取得しようとしているかを記録
    # =============================================================================
    print(f"🔍 [DEBUG] get_amedas_data関数呼び出し:")
    print(f"   - 受け取ったstation_id: {station_id} (type: {type(station_id)})")
    print(f"   - 受け取ったstation_name: {station_name} (type: {type(station_name)})")
    print(f"   - STATION_ID（デフォルト値）: {STATION_ID}")
    print(f"   - STATION_NAME（デフォルト値）: {STATION_NAME}")
    
    # =============================================================================
    # 【9-2. 使用する観測所の決定】
    # 1. リクエストから送信されたstation_idを優先
    # 2. なければデフォルト値（練馬）を使用
    # =============================================================================
    current_station_id = station_id or STATION_ID
    current_station_name = station_name or STATION_NAME
    
    print(f"🔍 [DEBUG] 最終的な観測所ID選択:")
    print(f"   - current_station_id: {current_station_id}")
    print(f"   - current_station_name: {current_station_name}")
    print(f"   - station_idがNoneまたは空: {not station_id}")
    
    # =============================================================================
    # 【9-3. 気象庁APIからデータ取得】
    # インターネット経由で気象庁の最新データを取得
    # =============================================================================
    try:
        # ステップ1: 最新のデータ時刻を取得
        latest_time_url = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt"
        r = requests.get(latest_time_url, timeout=10)
        tstr = r.text.strip()
        
        # 取得した時刻データを日時オブジェクトに変換
        try:
            latest = datetime.fromisoformat(tstr.replace('Z', '+00:00'))
        except ValueError:
            latest = datetime.fromtimestamp(int(tstr))

        # ステップ2: 最新データのURLを作成して気象データを取得
        ts = latest.strftime("%Y%m%d%H%M%S")
        data_url = f"https://www.jma.go.jp/bosai/amedas/data/map/{ts}.json"
        r2 = requests.get(data_url, timeout=10)
        
        # データ取得が失敗した場合はエラーを返す
        if r2.status_code != 200:
            print(f"❌ [DEBUG] 気象庁APIエラー: {r2.status_code}")
            return None
            
        # JSON形式のデータを辞書に変換
        all_data = r2.json()
        
        # デバッグ情報を追加
        print(f"🔍 [DEBUG] 気象庁APIからのデータ取得:")
        print(f"   - 要求された観測所ID: {current_station_id}")
        print(f"   - 要求された観測所名: {current_station_name}")
        print(f"   - APIから取得可能な観測所数: {len(all_data)}件")
        print(f"   - 要求された観測所IDが存在: {current_station_id in all_data}")
        
        # 利用可能な観測所IDの一部を表示（デバッグ用）
        available_stations = list(all_data.keys())[:10]  # 最初の10件のみ
        print(f"   - 利用可能な観測所ID（例）: {available_stations}")
        
        # 要求された観測所IDが存在するかチェック
        if current_station_id in all_data:
            print(f"✅ [DEBUG] 観測所ID {current_station_id} ({current_station_name}) のデータを取得します。")
            sd = all_data[current_station_id]
        else:
            print(f"❌ [DEBUG] 観測所ID {current_station_id} ({current_station_name}) が見つかりません。")
            
            # 代替観測所を探す（地域別に検索）
            alternative_station = find_alternative_station(current_station_id, all_data)
            
            if alternative_station:
                current_station_id = alternative_station["id"]
                current_station_name = alternative_station["name"]
                print(f"✅ [DEBUG] 代替観測所を使用: {current_station_id} ({current_station_name})")
                sd = all_data[current_station_id]
            else:
                # 最終フォールバック：利用可能な観測所から選択
                print(f"⚠️ [DEBUG] 代替観測所が見つかりません。利用可能な観測所から選択します。")
                available_stations = list(all_data.keys())
                if available_stations:
                    # 都市部の観測所を優先的に選択
                    priority_stations = ["44132", "47772", "47636", "82182", "12741", "34106"]  # 東京、大阪、名古屋、福岡、札幌、仙台
                    for priority_id in priority_stations:
                        if priority_id in available_stations:
                            current_station_id = priority_id
                            current_station_name = f"代替観測所({priority_id})"
                            sd = all_data[current_station_id]
                            print(f"✅ [DEBUG] 優先代替観測所を使用: {current_station_id} ({current_station_name})")
                            break
                    else:
                        # 優先観測所が見つからない場合は最初の利用可能な観測所を使用
                        current_station_id = available_stations[0]
                        current_station_name = f"代替観測所({current_station_id})"
                        sd = all_data[current_station_id]
                        print(f"✅ [DEBUG] 一般代替観測所を使用: {current_station_id} ({current_station_name})")
                else:
                    print(f"❌ [DEBUG] 利用可能な観測所が見つかりません。")
                    return None
        
        # 全天日射量データの取得（環境省の暑さ指数(WBGT)計算用）
        # 気象庁APIでは "sun1h" が1時間の日射量 [MJ/m²]
        solar_radiation = sd.get("sun1h", [None])[0]
        
        # UTC時刻を日本時間（JST）に変換
        jst = timezone(timedelta(hours=9))
        latest_jst = latest.astimezone(jst)
        
        result = {
            "station": current_station_name,
            "station_id": current_station_id,
            "time": latest_jst.strftime("%Y-%m-%d %H:%M:%S JST"),
            "temperature": sd.get("temp", [None])[0],
            "humidity": sd.get("humidity", [None])[0],
            "wind_speed": sd.get("wind", [None])[0],
            "solar_radiation": solar_radiation,  # 環境省の暑さ指数(WBGT)計算用
            "sunshine": sd.get("sun1h", [None])[0],  # 表示用（互換性のため残す）
        }
        
        print(f"🔍 [DEBUG] 最終的な観測所データ:")
        print(f"   - station: {result['station']}")
        print(f"   - station_id: {result['station_id']}")
        print(f"   - temperature: {result['temperature']}")
        
        return result
        
    except Exception as e:
        print(f"❌ [DEBUG] アメダスデータ取得エラー: {e}")
        return None

def find_alternative_station(requested_station_id, all_data):
    """
    要求された観測所IDに基づいて代替観測所を探す
    
    Parameters
    ----------
    requested_station_id : str
        要求された観測所ID
    all_data : dict
        利用可能な全観測所データ
    
    Returns
    -------
    dict or None
        代替観測所情報（id, name）
    """
    if not requested_station_id or not all_data:
        return None
    
    # 地域別の代替観測所マッピング
    regional_alternatives = {
        # 北海道
        "hokkaido": ["11016", "12442", "12741", "13277", "14163"],  # 稚内、旭川、札幌、留萌、帯広
        
        # 東北
        "tohoku": ["31011", "32056", "33056", "34106", "35426", "36106"],  # 青森、秋田、盛岡、仙台、山形、福島
        
        # 関東
        "kanto": ["44132", "44136", "43041", "43056", "45142", "45212", "46106", "47646"],  # 東京、練馬、さいたま、熊谷、千葉、船橋、横浜、宇都宮
        
        # 中部
        "chubu": ["47636", "48156", "49142", "50106", "51106", "52146", "54106"],  # 名古屋、高山、甲府、新潟、富山、金沢、長野
        
        # 関西
        "kansai": ["47772", "47746", "63106", "60106", "61106", "62078"],  # 大阪、京都、神戸、大津、奈良、和歌山
        
        # 中国・四国
        "chugoku_shikoku": ["66106", "67437", "68096", "69056", "71106", "72197", "73166", "74106"],  # 鳥取、松江、岡山、広島、徳島、高松、松山、高知
        
        # 九州・沖縄
        "kyushu_okinawa": ["81206", "82182", "83216", "84356", "85106", "86141", "87376", "91107"]  # 北九州、福岡、佐賀、長崎、熊本、大分、鹿児島、那覇
    }
    
    # 観測所IDの地域を判定（ID前2桁で判定）
    station_prefix = requested_station_id[:2] if len(requested_station_id) >= 2 else ""
    
    # ID前2桁に基づく地域判定
    region_mapping = {
        "11": "hokkaido", "12": "hokkaido", "13": "hokkaido", "14": "hokkaido", "15": "hokkaido",
        "31": "tohoku", "32": "tohoku", "33": "tohoku", "34": "tohoku", "35": "tohoku", "36": "tohoku",
        "40": "kanto", "41": "kanto", "42": "kanto", "43": "kanto", "44": "kanto", "45": "kanto", "46": "kanto", "47": "kanto",
        "48": "chubu", "49": "chubu", "50": "chubu", "51": "chubu", "52": "chubu", "53": "chubu", "54": "chubu",
        "55": "kansai", "56": "kansai", "57": "kansai", "58": "kansai", "59": "kansai", "60": "kansai", "61": "kansai", "62": "kansai", "63": "kansai",
        "64": "chugoku_shikoku", "65": "chugoku_shikoku", "66": "chugoku_shikoku", "67": "chugoku_shikoku", "68": "chugoku_shikoku", "69": "chugoku_shikoku",
        "71": "chugoku_shikoku", "72": "chugoku_shikoku", "73": "chugoku_shikoku", "74": "chugoku_shikoku",
        "81": "kyushu_okinawa", "82": "kyushu_okinawa", "83": "kyushu_okinawa", "84": "kyushu_okinawa", "85": "kyushu_okinawa", "86": "kyushu_okinawa", "87": "kyushu_okinawa",
        "91": "kyushu_okinawa", "92": "kyushu_okinawa"
    }
    
    target_region = region_mapping.get(station_prefix)
    
    if target_region and target_region in regional_alternatives:
        # 同じ地域の代替観測所を探す
        for alt_station_id in regional_alternatives[target_region]:
            if alt_station_id in all_data:
                return {
                    "id": alt_station_id,
                    "name": f"{target_region.upper()}地域代替観測所({alt_station_id})"
                }
    
    # 同じ地域に代替が見つからない場合、隣接地域を探す
    adjacent_regions = {
        "hokkaido": ["tohoku"],
        "tohoku": ["hokkaido", "kanto"],
        "kanto": ["tohoku", "chubu"],
        "chubu": ["kanto", "kansai"],
        "kansai": ["chubu", "chugoku_shikoku"],
        "chugoku_shikoku": ["kansai", "kyushu_okinawa"],
        "kyushu_okinawa": ["chugoku_shikoku"]
    }
    
    if target_region and target_region in adjacent_regions:
        for adj_region in adjacent_regions[target_region]:
            if adj_region in regional_alternatives:
                for alt_station_id in regional_alternatives[adj_region]:
                    if alt_station_id in all_data:
                        return {
                            "id": alt_station_id,
                            "name": f"隣接{adj_region.upper()}地域代替観測所({alt_station_id})"
                        }
    
    print(f"🔍 観測所ID {requested_station_id} (prefix: {station_prefix}) の代替観測所が見つかりませんでした。")
    return None

# =============================================================================
# 【10. 画像解析機能】
# 写真から環境の危険度を判定し、その場に応じたアドバイスをAIが生成します
# =============================================================================
def analyze_image_with_ai(image_data, age_group, context_data=None, timeout=AI_VISION_TIMEOUT):
    """
    【機能説明】
    Gemini AIの画像認識機能を使って、写真に写っている環境から
    熱中症の危険度を判定し、その場に応じたアドバイスを自動生成する機能
    
    【入力データ】
    image_data : Base64形式でエンコードされた画像データ
    age_group : 子供の年齢グループ ("0-1", "2-3", "4-6")
    context_data : その他の追加情報（オプション）
    timeout : AI応答の待ち時間上限（秒）
    
    【出力データ】
    ai_analysis: AI解析結果（文章）
    environmental_factors: 環境要因のリスト
    heat_risk_factors: 熱中症リスク要因のリスト
    recommendations: 推奨事項のリスト
    ai_generated: AIが生成したかどうか（True/False）
    processing_time: 処理にかかった時間
    status: 処理の成功/失敗状況
    """
    start_time = time.time()
    
    # フォールバック結果
    fallback_result = {
        "ai_analysis": "画像解析機能が利用できません。",
        "environmental_factors": [],
        "heat_risk_factors": [],
        "recommendations": ["画像が確認できませんが、一般的な熱中症対策を心がけてください。"],
        "ai_generated": False,
        "processing_time": time.time() - start_time,
        "status": "fallback",
        "ai_confidence": 0.0
    }
    
    if not GEMINI_API_KEY:
        fallback_result["status"] = "fallback_no_api_key"
        return fallback_result
    
    def vision_analysis_worker():
        try:
            # 年齢グループに応じた説明
            age_descriptions = {
                "0-1": "0-1歳の乳児（身長約0.6-0.8m、自身の体調について伝えることができない）",
                "2-3": "2-3歳の幼児（身長約0.8-1.0m、言葉は覚えるが体調が悪くなりそうなど前兆がわからない）",
                "4-6": "4-6歳の幼児・園児（身長約1.0-1.2m、ある程度自分のことを伝えられるようになる）"
            }
            
            # 画像解析用の危険レベル別プロンプト
            prompt = f"""
この画像から体調を分析して、以下の形式で箇条書きのみを出力してください。説明や挨拶は不要です。
各項目間には必ず改行を入れて見やすくしてください。

• 体調分析: 顔の表情・姿勢・汗の量などから判断される熱中症の兆候や体調の危険度

• 水分補給: 子ども用コップ（150–200ml）で○杯、○分間隔での摂取を推奨（脱水防止を目的）

• 空調設定: 室内に戻った際の冷房設定温度（○℃）と、必要であれば衣服調整の提案も含めて出力

• 注意事項: この環境で{age_descriptions.get(age_group, age_group)}が特に気をつけるべき体調面のリスクや行動ポイント

上記のような形式で、この画像環境における{age_descriptions.get(age_group, age_group)}への対策を4項目で出力してください。

画像から判断される子どもの様子に応じて、適切なレベルのアドバイスを出力してください。
各項目の間には必ず空行を入れてください。
"""

            # Gemini Vision APIを呼び出し
            model = genai.GenerativeModel('gemini-2.0-flash-lite')
            
            # 画像データを準備
            image_part = {
                "mime_type": "image/jpeg",
                "data": image_data
            }
            
            response = model.generate_content(
                [prompt, image_part],
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=500,
                    temperature=0.7
                )
            )
            
            if response.text:
                try:
                    # JSONパースを試行
                    import re
                    json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
                    if json_match:
                        result = json.loads(json_match.group())
                        # 必要なキーが含まれているかチェック
                        required_keys = ["ai_analysis", "environmental_factors", "heat_risk_factors", "recommendations"]
                        if all(key in result for key in required_keys):
                            return result
                    
                    # JSONパースに失敗した場合、テキストから情報を抽出
                    return {
                        "ai_analysis": response.text.strip(),
                        "environmental_factors": ["画像解析によるテキスト応答"],
                        "heat_risk_factors": [],
                        "recommendations": ["AI解析結果を参考に適切な対策を行ってください。"],
                        "ai_confidence": 0.8
                    }
                except Exception as parse_error:
                    print(f"JSON解析エラー: {parse_error}")
                    return {
                        "ai_analysis": response.text.strip(),
                        "environmental_factors": ["AI解析完了"],
                        "heat_risk_factors": [],
                        "recommendations": ["画像解析が完了しました。結果を参考にしてください。"],
                        "ai_confidence": 0.7
                    }
            
            return None
            
        except Exception as e:
            print(f"Gemini Vision API呼び出しエラー: {e}")
            return None
    
    try:
        # タイムアウト付きでAI処理を実行
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(vision_analysis_worker)
            try:
                ai_result = future.result(timeout=timeout)
                if ai_result:
                    ai_result.update({
                        "ai_generated": True,
                        "processing_time": time.time() - start_time,
                        "status": "success"
                    })
                    return ai_result
                else:
                    fallback_result["status"] = "ai_failed"
                    return fallback_result
                    
            except concurrent.futures.TimeoutError:
                print(f"AI 画像解析がタイムアウトしました（{timeout}秒）")
                fallback_result["status"] = "timeout"
                fallback_result["processing_time"] = timeout
                return fallback_result
                
    except Exception as e:
        print(f"AI 画像解析で予期しないエラー: {e}")
        fallback_result["status"] = "error"
        fallback_result["processing_time"] = time.time() - start_time
        return fallback_result

# =============================================================================
# 【11. 画像比較分析機能】
# 外出前後の2枚の写真を比較して、疲労度や変化をAIが分析します
# =============================================================================
def analyze_images_comparison(before_image_data, after_image_data, age_group, time_difference_minutes=None, before_timestamp=None, after_timestamp=None, context_data=None, timeout=AI_VISION_TIMEOUT):
    """
    【機能説明】
    外出前後の2枚の写真をAIが比較分析して、
    子供の疲労度や変化を検出し、帰宅後のケア方法を提案する機能
    
    【入力データ】
    before_image_data : 外出前の画像（Base64形式）
    after_image_data : 帰宅後の画像（Base64形式）
    age_group : 子供の年齢グループ ("0-1", "2-3", "4-6")
    time_difference_minutes : 外出していた時間（分）
    before_timestamp : 外出前の時刻
    after_timestamp : 帰宅後の時刻
    context_data : その他の追加情報（オプション）
    timeout : AI応答の待ち時間上限（秒）
    
    【出力データ】
    comparison_analysis: 2枚の画像比較分析結果
    time_difference: 外出時間の差（分）
    changes_detected: 検出された変化のリスト
    recommendations: 帰宅後のケア推奨事項
    ai_generated: AIが生成したかどうか（True/False）
    processing_time: 処理にかかった時間
    status: 処理の成功/失敗状況
    """
    start_time = time.time()
    
    # フォールバック結果（箇条書き形式）
    fallback_result = {
        "ai_analysis": "画像差分分析機能が利用できません。一般的な熱中症対策を心がけてください。こまめな水分補給が大切です。日陰での休憩を取りましょう。",
        "time_difference": time_difference_minutes or 0,
        "changes_detected": [],
        "recommendations": ["画像の比較ができませんが、一般的な熱中症対策を心がけてください。"],
        "ai_generated": False,
        "processing_time": time.time() - start_time,
        "status": "fallback",
        "ai_confidence": 0.0
    }
    
    if not GEMINI_API_KEY:
        fallback_result["status"] = "fallback_no_api_key"
        return fallback_result
    
    def comparison_analysis_worker():
        try:
            # 年齢グループに応じた説明
            age_descriptions = {
                "0-1": "0-1歳の乳児（身長約0.6-0.8m、自身の体調について伝えることができない）",
                "2-3": "2-3歳の幼児（身長約0.8-1.0m、言葉は覚えるが体調が悪くなりそうなど前兆がわからない）",
                "4-6": "4-6歳の幼児・園児（身長約1.0-1.2m、ある程度自分のことを伝えられるようになる）"
            }
            
            # 時間情報の処理
            time_info = ""
            if time_difference_minutes is not None:
                hours = time_difference_minutes // 60
                minutes = time_difference_minutes % 60
                if hours > 0:
                    time_info = f"外出時間: {hours}時間{minutes}分"
                else:
                    time_info = f"外出時間: {minutes}分"
            
            # 差分分析用の危険レベル別プロンプト
            prompt = f"""
2枚の画像（外出前・帰宅後）を比較して、以下の形式で箇条書きのみを出力してください。説明や挨拶は不要です。
各項目間には必ず改行を入れて見やすくしてください。

• 体調の変化の影響: 画像から判断される疲労度や暑さの影響

• 水分補給: 帰宅後は子ども用コップ（150-200ml）で○杯、○分間隔で摂取推奨

• 空調設定: 帰宅直後の室温は○℃に調整推奨

• 体調確認: 画像の変化から判断される注意点や確認項目

上記のような形式で、外出前後の画像比較から{age_descriptions.get(age_group, age_group)}への帰宅後対策を4項目で出力してください。

外出による疲労度別の帰宅後対応：
- 重度疲労（長時間・炎天下・顔色や服装の大きな変化）: 水分4-5杯・10分間隔・空調22-24℃・頻繁な体調確認
- 中度疲労（中時間・暑い・軽微な変化）: 水分3-4杯・15分間隔・空調24-26℃・定期的な体調確認
- 軽度疲労（短時間・普通・変化なし）: 水分2-3杯・30分間隔・空調26-27℃・通常の体調確認

外出前後の画像の変化（顔色、服装の汚れ、表情、疲労の兆候など）と{time_info}を考慮して、適切なレベルの帰宅後ケアを提案してください。
各項目の間には必ず空行を入れて、読みやすくしてください。"""

            # Gemini Vision APIを呼び出し
            model = genai.GenerativeModel('gemini-2.0-flash-lite')
            
            # 画像データを準備
            before_image_part = {
                "mime_type": "image/jpeg",
                "data": before_image_data
            }
            
            after_image_part = {
                "mime_type": "image/jpeg",
                "data": after_image_data
            }
            
            response = model.generate_content(
                [prompt, before_image_part, after_image_part],
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=700,
                    temperature=0.7
                )
            )
            
            if response.text:
                # 直接テキストを返す（箇条書き形式）
                return {
                    "ai_analysis": response.text.strip(),
                    "time_difference": time_difference_minutes or 0,
                    "changes_detected": ["AI差分分析完了"],
                    "recommendations": ["画像差分分析結果を参考に適切な対策を行ってください。"],
                    "ai_confidence": 0.9
                }
            
            return None
            
        except Exception as e:
            print(f"Gemini Vision API差分分析エラー: {e}")
            return None
    
    try:
        # タイムアウト付きでAI処理を実行
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(comparison_analysis_worker)
            try:
                ai_result = future.result(timeout=timeout)
                if ai_result:
                    ai_result.update({
                        "ai_generated": True,
                        "processing_time": time.time() - start_time,
                        "status": "success"
                    })
                    return ai_result
                else:
                    fallback_result["status"] = "ai_failed"
                    return fallback_result
                    
            except concurrent.futures.TimeoutError:
                print(f"AI 差分分析がタイムアウトしました（{timeout}秒）")
                fallback_result["status"] = "timeout"
                fallback_result["processing_time"] = timeout
                return fallback_result
                
    except Exception as e:
        print(f"AI 差分分析で予期しないエラー: {e}")
        fallback_result["status"] = "error"
        fallback_result["processing_time"] = time.time() - start_time
        return fallback_result

@functions_framework.http
def compare_images(request):
    """
    画像差分分析用のHTTPエンドポイント
    """
    start_time = time.time()
    
    # CORS対応
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8'
    }
    
    if request.method != 'POST':
        error_resp = {
            "error": "無効なHTTPメソッド",
            "message": "POSTメソッドを使用してください",
            "method": request.method
        }
        return (json.dumps(error_resp, ensure_ascii=False), 405, headers)
    
    try:
        # リクエストボディの解析
        request_json = request.get_json()
        if not request_json:
            error_resp = {
                "error": "無効なリクエスト",
                "message": "JSONペイロードが必要です"
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        before_image = request_json.get('before_image')
        after_image = request_json.get('after_image')
        age_group = request_json.get('age_group', '2-3')
        time_difference_minutes = request_json.get('time_difference_minutes')
        before_timestamp = request_json.get('before_timestamp')
        after_timestamp = request_json.get('after_timestamp')
        
        if not before_image or not after_image:
            error_resp = {
                "error": "画像データが必要",
                "message": "before_imageとafter_imageパラメータが必要です"
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        # 年齢グループの検証
        valid_age_groups = ["0-1", "2-3", "4-6"]
        if age_group not in valid_age_groups:
            error_resp = {
                "error": "無効な年齢グループ",
                "message": f"age_groupは {valid_age_groups} のいずれかを指定してください",
                "provided": age_group
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        # AI画像差分分析を実行
        comparison_result = analyze_images_comparison(
            before_image, after_image, age_group, 
            time_difference_minutes, before_timestamp, after_timestamp
        )
        
        # レスポンスペイロードを構築
        response_payload = {
            "comparison_analysis": comparison_result,
            "ai_features": {
                "vision_enabled": GEMINI_API_KEY is not None,
                "vision_model": "gemini-2.0-flash-lite" if GEMINI_API_KEY else None,
                "processing_time": comparison_result.get("processing_time", 0),
                "timeout_setting": AI_VISION_TIMEOUT
            },
            "metadata": {
                "api_version": "4.2",
                "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
                "age_group": age_group,
                "time_difference_minutes": time_difference_minutes,
                "before_timestamp": before_timestamp,
                "after_timestamp": after_timestamp,
                "total_processing_time": time.time() - start_time
            }
        }
        
        return (json.dumps(response_payload, ensure_ascii=False), 200, headers)
        
    except Exception as e:
        error_resp = {
            "error": "内部エラー",
            "message": str(e),
            "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
            "processing_time": time.time() - start_time
        }
        return (json.dumps(error_resp, ensure_ascii=False), 500, headers)

@functions_framework.http
def analyze_image(request):
    """
    画像解析用のHTTPエンドポイント
    """
    start_time = time.time()
    
    # CORS対応
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8'
    }
    
    if request.method != 'POST':
        error_resp = {
            "error": "無効なHTTPメソッド",
            "message": "POSTメソッドを使用してください",
            "method": request.method
        }
        return (json.dumps(error_resp, ensure_ascii=False), 405, headers)
    
    try:
        # リクエストボディの解析
        request_json = request.get_json()
        if not request_json:
            error_resp = {
                "error": "無効なリクエスト",
                "message": "JSONペイロードが必要です"
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        image_data = request_json.get('image_data')
        age_group = request_json.get('age_group', '2-3')
        
        if not image_data:
            error_resp = {
                "error": "画像データが必要",
                "message": "image_dataパラメータが必要です"
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        # 年齢グループの検証
        valid_age_groups = ["0-1", "2-3", "4-6"]
        if age_group not in valid_age_groups:
            error_resp = {
                "error": "無効な年齢グループ",
                "message": f"age_groupは {valid_age_groups} のいずれかを指定してください",
                "provided": age_group
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        # AI画像解析を実行
        analysis_result = analyze_image_with_ai(image_data, age_group)
        
        # レスポンスペイロードを構築
        response_payload = {
            "image_analysis": analysis_result,
            "ai_features": {
                "vision_enabled": GEMINI_API_KEY is not None,
                "vision_model": "gemini-2.0-flash-lite" if GEMINI_API_KEY else None,
                "processing_time": analysis_result.get("processing_time", 0),
                "timeout_setting": AI_VISION_TIMEOUT
            },
            "metadata": {
                "api_version": "4.1",
                "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
                "age_group": age_group,
                "total_processing_time": time.time() - start_time
            }
        }
        
        return (json.dumps(response_payload, ensure_ascii=False), 200, headers)
        
    except Exception as e:
        error_resp = {
            "error": "内部エラー",
            "message": str(e),
            "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
            "processing_time": time.time() - start_time
        }
        return (json.dumps(error_resp, ensure_ascii=False), 500, headers)

# =============================================================================
# 【12. メインAPIエンドポイント】
# Webアプリから呼び出される、熱中症リスク判定のメイン機能です
# =============================================================================
@functions_framework.http
def heat_risk(request):
    """
    【機能説明】
    このアプリのメイン機能。Webアプリから呼び出されて、
    気象データを取得し、暑さ指数を計算し、AIアドバイスを生成して返す
    
    【処理の流れ】
    1. リクエストパラメータの解析
    2. 気象庁からデータ取得
    3. 暑さ指数(WBGT)計算
    4. 年齢別リスクレベル判定
    5. AIアドバイス生成
    6. 画像解析（画像がある場合）
    7. 結果をJSON形式で返送
    """
    start_time = time.time()  # 処理時間測定開始
    
    # =============================================================================
    # 【12-1. CORS対応とHTTPヘッダー設定】
    # Webブラウザからのアクセスを許可するための設定
    # =============================================================================
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',  # 全てのドメインからのアクセス許可
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',  # 許可するHTTPメソッド
            'Access-Control-Allow-Headers': 'Content-Type',  # 許可するヘッダー
            'Access-Control-Max-Age': '3600'  # プリフライトリクエストのキャッシュ時間
        }
        return ('', 204, headers)

    headers = {
        'Access-Control-Allow-Origin': '*',  # 全てのドメインからのアクセス許可
        'Content-Type': 'application/json; charset=utf-8'  # レスポンス形式の設定
    }
    
    # =============================================================================
    # 【12-2. リクエストパラメータの解析】
    # Webアプリやモバイルアプリから送信されたデータを解析
    # =============================================================================
    try:
        # リクエストパラメータの取得
        if request.method == 'POST':
            request_json = request.get_json() or {}
            age_group = request_json.get('age_group') or request.args.get('age_group', '2-3')
            detailed = str(request_json.get('detailed', request.args.get('detailed', 'false'))).lower() == 'true'
            
            # 観測所情報（GPS機能連携）
            station_id = request_json.get('station_id')
            station_name = request_json.get('station_name')
            
            # デバッグ: リクエストから受け取った観測所情報をログ出力
            print(f"🔍 [POST] リクエストから受け取った観測所情報:")
            print(f"   - station_id: {station_id}")
            print(f"   - station_name: {station_name}")
            print(f"   - リクエスト全体: {request_json}")
            
            # 単一画像解析
            image_data = request_json.get('image_data')
            include_image_analysis = request_json.get('include_image_analysis', False)
            
            # 差分画像解析
            before_image = request_json.get('before_image')
            after_image = request_json.get('after_image')
            include_comparison_analysis = request_json.get('include_comparison_analysis', False)
            time_difference_minutes = request_json.get('time_difference_minutes')
            before_timestamp = request_json.get('before_timestamp')
            after_timestamp = request_json.get('after_timestamp')
        else:
            age_group = request.args.get('age_group', '2-3')
            detailed = request.args.get('detailed', 'false').lower() == 'true'
            station_id = request.args.get('station_id')
            station_name = request.args.get('station_name')
            
            # デバッグ: GETリクエストから受け取った観測所情報をログ出力
            print(f"🔍 [GET] リクエストから受け取った観測所情報:")
            print(f"   - station_id: {station_id}")
            print(f"   - station_name: {station_name}")
            
            image_data = None
            include_image_analysis = False
            before_image = None
            after_image = None
            include_comparison_analysis = False
            time_difference_minutes = None
            before_timestamp = None
            after_timestamp = None
        
        # 年齢グループの検証
        valid_age_groups = ["0-1", "2-3", "4-6"]
        if age_group not in valid_age_groups:
            error_resp = {
                "error": "無効な年齢グループ",
                "message": f"age_groupは {valid_age_groups} のいずれかを指定してください",
                "provided": age_group
            }
            return (json.dumps(error_resp, ensure_ascii=False), 400, headers)
        
        data = get_amedas_data(station_id, station_name)
        if not data:
            # フォールバックデータを使用（テスト用の現実的なデータ）
            now = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9)))  # JSTに変換
            month = now.month
            hour = now.hour
            
            # 季節と時間による気温の調整
            if month in [12, 1, 2]:  # 冬
                base_temp = 8 if 6 <= hour <= 18 else 3
                humidity_base = 50
            elif month in [3, 4, 5]:  # 春
                base_temp = 18 if 6 <= hour <= 18 else 12
                humidity_base = 60
            elif month in [6, 7, 8]:  # 夏
                base_temp = 32 if 6 <= hour <= 18 else 26
                humidity_base = 75
            else:  # 秋
                base_temp = 20 if 6 <= hour <= 18 else 15
                humidity_base = 65
            
            # 時間による調整
            if 10 <= hour <= 14:  # 日中のピーク
                temp_adjustment = 5
                solar_radiation = 2.5
            elif 6 <= hour <= 10 or 14 <= hour <= 18:  # 朝夕
                temp_adjustment = 0
                solar_radiation = 1.0
            else:  # 夜間
                temp_adjustment = -5
                solar_radiation = 0.0
            
            # ランダムな変動を加える
            temperature = base_temp + temp_adjustment + random.uniform(-3, 3)
            humidity = humidity_base + random.uniform(-15, 15)
            wind_speed = random.uniform(0.5, 3.0)
            
            # 範囲チェック
            temperature = max(-10, min(45, temperature))
            humidity = max(20, min(100, humidity))
            wind_speed = max(0, min(10, wind_speed))
            
            data = {
                "station": f"{STATION_NAME} (フォールバックデータ)",
                "station_id": STATION_ID,
                "time": now.strftime("%Y-%m-%d %H:%M:%S JST"),
                "temperature": round(temperature, 1),
                "humidity": round(humidity),
                "wind_speed": round(wind_speed, 1),
                "solar_radiation": round(solar_radiation, 1),
                "sunshine": round(solar_radiation, 1),
            }

        wbgt = calculate_wbgt(data['temperature'], data['humidity'], data['wind_speed'], data['solar_radiation'])
        risk = get_heat_risk_level(wbgt, age_group, data['temperature'], data['humidity'])
        
        # 年齢別体感気温計算（常に実行）
        child_temp_min, child_temp_max, ground_temp_normal, ground_temp_asphalt, correction_range = calculate_child_temperatures(data['temperature'], age_group)

        # AI生成の詳細推奨事項（タイムアウト対応）
        detailed_recommendations = generate_detailed_recommendations(
            wbgt, age_group, data['temperature'], data['humidity'], risk['level'], data
        )

        # 画像解析（画像データがある場合のみ）
        image_analysis_result = None
        if image_data and include_image_analysis:
            image_analysis_result = analyze_image_with_ai(image_data, age_group)
        
        # 差分画像解析（2枚の画像がある場合のみ）
        comparison_analysis_result = None
        if before_image and after_image and include_comparison_analysis:
            comparison_analysis_result = analyze_images_comparison(
                before_image, after_image, age_group, 
                time_difference_minutes, before_timestamp, after_timestamp
            )

        # 詳細なペイロード作成
        payload = {
            # 基本観測データ
            "observation": {
                "station": data["station"],
                "station_id": data["station_id"],
                "time": data["time"],
                "temperature": data["temperature"],
                "humidity": data["humidity"],
                "wind_speed": data["wind_speed"],
                "solar_radiation": data["solar_radiation"],
                "sunshine": data["sunshine"]
            },
            
            # 暑さ指数(WBGT)計算結果
            "wbgt_analysis": {
                "wbgt": wbgt,
                "calculation_method": "環境省公式の暑さ指数(WBGT)計算式（小野ら2014回帰式）",
                "formula": "暑さ指数(WBGT) = 0.735 * Ta + 0.0374 * RH + 0.00292 * Ta * RH + 7.619 * SR - 4.557 * (SR^2) - 0.0572 * WS - 4.064",
                "parameters_used": {
                    "Ta": data["temperature"],  # 気温 [℃]
                    "RH": data["humidity"],     # 相対湿度 [%]
                    "SR": data["solar_radiation"] * 0.278 if data["solar_radiation"] else 0.6,  # 日射強度 [kW/m²]
                    "WS": data["wind_speed"] if data["wind_speed"] else 1.0  # 風速 [m/s]
                },
                "data_source": "気象庁AMeDAS（全天日射量含む）",
                "reference": "https://www.wbgt.env.go.jp/wbgt_detail.php"
            },
            
            # 年齢グループ別分析（AI強化、タイムアウト対応）
            "age_group_analysis": {
                "target_age_group": age_group,
                "risk_level": risk["level"],
                "risk_color": risk["color"],
                "advice_message": risk["message"],  # AI生成メッセージ
                "ai_generated": risk.get("ai_generated", False),
                "ai_advice": risk.get("ai_advice", risk["message"]),
                "ai_processing_time": risk.get("ai_processing_time", 0),
                "ai_status": risk.get("ai_status", "unknown"),
                "methodology": "子どもは大人より地面に近く、より暑い環境にいるため基準を厳しく設定",
                "thresholds": {
                    "0-1": {"注意": 16, "警戒": 19, "厳重警戒": 22, "危険": 25, "説明": "乳児：体調を伝えられないため最も厳しい基準"},
                    "2-3": {"注意": 17, "警戒": 20, "厳重警戒": 23, "危険": 26, "説明": "幼児：経験が乏しく前兆がわからないため厳しい基準"},
                    "4-6": {"注意": 18, "警戒": 21, "厳重警戒": 24, "危険": 27, "説明": "幼児・園児：ある程度伝えられるが地面に近いため注意"},
                    "adult": {"注意": 22, "警戒": 25, "厳重警戒": 28, "危険": 31, "説明": "大人の基準（気象庁の測定と同じ高さ）"}
                }
            },
            
            # 子ども向け体感気温分析
            "child_temperature_analysis": {
                "adult_temperature": data["temperature"],
                "child_feels_like_min": child_temp_min,
                "child_feels_like_max": child_temp_max,
                "temperature_difference": {
                    "min": child_temp_min - data["temperature"] if child_temp_min and data["temperature"] else None,
                    "max": child_temp_max - data["temperature"] if child_temp_max and data["temperature"] else None
                },
                "ground_temperatures": {
                    "normal_ground": ground_temp_normal,
                    "asphalt": ground_temp_asphalt,
                    "difference_from_air": {
                        "normal": 8.0,
                        "asphalt": 15.0
                    }
                },
                "height_factor": {
                    "age_group": age_group,
                    "average_height": {
                        "0-1": "約0.6-0.8m",
                        "2-3": "約0.8-1.0m", 
                        "4-6": "約1.0-1.2m"
                    }.get(age_group, "不明"),
                    "correction_range": correction_range,
                    "explanation": f"{age_group}歳の子どもは身長が低く、大人より約{correction_range['min']}℃〜{correction_range['max']}℃高い環境にいます"
                }
            },
            
            # AI強化されたほぼ安全対策の提案（タイムアウト対応）
            "safety_recommendations": {
                "general": detailed_recommendations["general"],
                "age_specific": detailed_recommendations["age_specific"],
                "ai_generated": detailed_recommendations.get("ai_generated", False),
                "ai_processing_time": detailed_recommendations.get("processing_time", 0),
                "ai_status": detailed_recommendations.get("status", "unknown"),
                "generation_method": "Gemini AI による動的生成" if detailed_recommendations.get("ai_generated") else "固定テンプレート"
            }
        }

        # 画像解析結果を追加（画像がある場合のみ）
        if image_analysis_result:
            payload["image_analysis"] = image_analysis_result
        
        # 差分分析結果を追加（差分画像がある場合のみ）
        if comparison_analysis_result:
            payload["comparison_analysis"] = comparison_analysis_result

        # AI機能の情報（タイムアウト対応強化）
        payload["ai_features"] = {
            "enabled": GEMINI_API_KEY is not None,
            "model": "gemini-2.0-flash-lite" if GEMINI_API_KEY else None,
            "vision_enabled": GEMINI_API_KEY is not None and image_data is not None,
            "timeout_settings": {
                "ai_advice_timeout": AI_ADVICE_TIMEOUT,
                "ai_recommendations_timeout": AI_RECOMMENDATIONS_TIMEOUT,
                "ai_vision_timeout": AI_VISION_TIMEOUT,
                "total_timeout": AI_TIMEOUT_SECONDS
            },
            "capabilities": [
                "個別化されたアドバイス生成",
                "状況に応じた推奨事項",
                "年齢・時間帯を考慮した提案",
                "温かみのある自然な表現",
                "タイムアウト対応による高速レスポンス",
                "画像解析による環境評価" if GEMINI_API_KEY else None
            ] if GEMINI_API_KEY else ["固定テンプレートによる基本的なアドバイス"],
            "fallback_mode": not bool(GEMINI_API_KEY),
            "performance": {
                "ai_advice_time": risk.get("ai_processing_time", 0),
                "ai_recommendations_time": detailed_recommendations.get("processing_time", 0),
                "ai_vision_time": image_analysis_result.get("processing_time", 0) if image_analysis_result else 0,
                "ai_comparison_time": comparison_analysis_result.get("processing_time", 0) if comparison_analysis_result else 0,
                "total_processing_time": time.time() - start_time
            }
        }
        
        # メタデータ
        payload["metadata"] = {
            "api_version": "4.3",  # 差分画像解析機能追加によりバージョンアップ
            "calculation_timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
            "data_source": "気象庁アメダス（全天日射量含む）",
            "wbgt_method": "環境省公式 小野ら(2014)回帰式による暑さ指数(WBGT)",
            "ai_integration": "Gemini AI による動的アドバイス生成（タイムアウト対応）+ Vision解析",
            "age_groups_supported": ["0-1", "2-3", "4-6"],
            "image_analysis_included": bool(image_analysis_result),
            "comparison_analysis_included": bool(comparison_analysis_result),
            "improvements": [
                "環境省公式の暑さ指数(WBGT)計算式に変更",
                "気象庁のアメダスデータから全天日射量データを取得",
                "Gemini AIによる個別化アドバイス生成",
                "より正確な熱中症リスク評価",
                "状況に応じた動的推奨事項生成",
                "AI処理のタイムアウト対応による高速レスポンス",
                "フォールバック機能の強化",
                "日本時間（JST）への時刻変換対応",
                "Gemini Vision AIによる画像解析機能",
                "2枚の画像による差分分析機能（外出前後の変化検出）"
            ],
            "units": {
                "temperature": "℃",
                "humidity": "%",
                "wind_speed": "m/s",
                "solar_radiation": "MJ/m²",
                "wbgt": "℃（暑さ指数）"
            }
        }

        return (json.dumps(payload, ensure_ascii=False), 200, headers)
        
    except Exception as e:
        error_resp = {
            "error": "内部エラー",
            "message": str(e),
            "timestamp": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S JST"),
            "ai_enabled": GEMINI_API_KEY is not None,
            "processing_time": time.time() - start_time
        }
        return (json.dumps(error_resp, ensure_ascii=False), 500, headers)


# =============================================================================
# 【13. ローカルテスト用のコード】
# 開発者がローカル環境でテストする際に使用するコード
# =============================================================================
if __name__ == "__main__":
    import functions_framework
    functions_framework.testing.run_function_with_test_client(heat_risk)

# =============================================================================
# 【14. 必要なライブラリ一覧】
# このプログラムを動かすために必要なPythonライブラリのバージョン指定
# requirements.txt ファイルに記載する内容:
# =============================================================================
# functions-framework>=3.0.0  # Google Cloud Functions用
# requests>=2.28.0             # HTTP通信用
# google-generativeai>=0.3.0   # Google AI用
