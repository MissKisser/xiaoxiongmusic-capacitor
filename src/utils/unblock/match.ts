/**
 * 站外源通用「歌名 + 歌手 + 时长」三重校验与直链可用性校验
 *
 * 酷我 / 波点两个站外源的搜索结果都只是「候选」，
 * 直接取第一条命中会拿到错版本（Remix、伴奏、翻唱、现场版等），
 * 且酷我的 128k 通道还会返回与请求歌曲无关的固定占位文件。
 * 本模块把两处重复的匹配逻辑收敛为一份，供两个站外源共用。
 */

/** 请求侧的目标歌曲信息 */
export type MatchTarget = {
  /** 请求歌名 */
  title: string
  /** 请求歌手 */
  artist: string
  /** 请求时长（秒）；不传则跳过时长校验 */
  duration?: number
}

/** 候选歌曲的统一结构（各源检索后统一成此结构再送入校验） */
export type MatchCandidate = {
  /** 候选在源内的唯一标识 */
  id: string
  /** 候选歌名 */
  title: string
  /** 候选歌手 */
  artist: string
  /** 候选自带时长（秒） */
  duration?: number
}

/** 单个候选的校验明细 */
export type CandidateScore = {
  /** 候选本身 */
  candidate: MatchCandidate
  /** 歌名相似度 0~1 */
  titleScore: number
  /** 歌手相似度 0~1 */
  artistScore: number
  /** 时长接近度 0~1；未参与时长校验时为 null */
  durationScore: number | null
  /** 综合得分 0~1 */
  score: number
  /** 是否通过三重校验 */
  passed: boolean
}

/** 歌名相似度下限：低于该值视为不是同一首歌 */
export const TITLE_SCORE_LIMIT = 0.75

/** 歌手相似度下限：低于该值视为不是同一位歌手 */
const ARTIST_SCORE_LIMIT = 0.5

/** 目标缺歌名时的拒绝原因（用户可读） */
export const MISSING_TITLE_REASON = '缺少歌名信息，无法安全换源'

/** 目标缺歌手时的拒绝原因（用户可读） */
export const MISSING_ARTIST_REASON = '缺少歌手信息，无法安全换源'

/** 上游检索不可用时的失败原因（用户可读） */
export const UPSTREAM_UNAVAILABLE_REASON = '上游检索服务不可用'

/** 没有检索到任何候选时的失败原因（用户可读） */
export const NO_CANDIDATE_REASON = '该源未检索到候选歌曲'

/** 有候选但都没通过三重校验时的失败原因（用户可读） */
export const MATCH_FAILED_REASON = '候选未通过歌名/歌手/时长校验'

/** 候选通过校验但取不到直链时的失败原因（用户可读） */
export const FETCH_FAILED_REASON = '候选未取到可用直链'

/** 上游只提供试听片段 / 占位资源时的失败原因（用户可读） */
export const TRIAL_ONLY_REASON = '该曲在此源仅提供试听片段，无完整版权资源'

/** 综合得分权重 */
const TITLE_WEIGHT = 0.45
const ARTIST_WEIGHT = 0.35
const DURATION_WEIGHT = 0.2

/**
 * 版本变体标记：候选歌名命中且请求歌名未命中时，判定为「同一首歌的其他版本」
 *
 * 词表分两类：
 * - 表示「非原版 / 非完整」的词必须保留（DJ、Remix、翻唱、伴奏、纯音乐、片段、试听……），
 *   命中即折半，防止把变体当原版播出去；
 * - 只表示「同一首歌的发行说明」的词（完整版、独家）不出现在此表中，
 *   它们大量出现在正片标题上，作为变体标记会误杀原版。
 *
 * 语种 / 演唱形态这一族（粤语版、国语版、对唱版、说唱版、合唱版、独唱版）
 * 是实测补入的：它们记录的是「同一首歌的不同录音版本」，
 * 与「发行说明」不同类，作为变体标记不会误杀正片标题。
 * 女声版 / 男声版不再单列——已被既有的「女声 / 男声」标记覆盖。
 */
const VERSION_MARKERS = [
  'dj',
  'remix',
  'rmx',
  'live',
  '伴奏',
  'instrumental',
  '纯音乐',
  '钢琴',
  '吉他',
  '二胡',
  '古筝',
  '唢呐',
  '爵士',
  '摇滚',
  '女声',
  '男声',
  '女版',
  '男版',
  'cover',
  '翻唱',
  '翻自',
  '翻奏',
  '消音',
  '现场',
  '演唱会',
  'slowed',
  'sped',
  '变速',
  '慢速',
  'extended',
  'radioedit',
  'remaster',
  'demo',
  '试听',
  '片段',
  '旧版',
  '影视原声',
  '综艺',
  '串烧',
  '合辑',
  '广场舞',
  '铃声',
  '电台',
  '主播',
  '八音盒',
  '重混',
  'chunk',
  'vocal',
  'acoustic',
  'unplugged',
  'reprise',
  'karaoke',
  'ktv',
  '粤语版',
  '国语版',
  '对唱版',
  '说唱版',
  '合唱版',
  '独唱版',
]

/** 歌手分隔符（多歌手曲目按这些符号拆成若干歌手） */
const ARTIST_SEPARATOR = /[&、,，/＋+·]|feat\.|ft\.|with|\bx\b/gi

/**
 * 副歌手（合作 / feat）单独命中时的分值
 *
 * 该值必须低于 ARTIST_SCORE_LIMIT：候选歌手栏位里的副歌手命中不等于同一版本，
 * 实测请求《大梦归》/ 周深 会命中候选「蛋ZAI / 周深-」（43 秒的另一版本），
 * 之前按「任一 token 命中即满分」给出 1.0，只靠时长校验兜住；
 * 候选缺时长时时长校验不参与，错误版本会被直接放行。
 */
const SECONDARY_ARTIST_SCORE = 0.4

/**
 * 繁简字映射表：繁体字 → 简体字
 *
 * 站外源（酷我 / 波点）的曲目标题与歌手名常是繁体（「春嬌與志明」），
 * 而请求侧来自平台接口，多为简体；不做转换时字形差异会把同一首歌的
 * 歌名相似度从 1.0 拉到 0.6 上下、歌手相似度拉到 0，直接卡在门槛之下。
 * 繁体与简体是同一个词的两种写法，转换不改变判定语义。
 */
const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  們: '们',
  個: '个',
  這: '这',
  來: '来',
  說: '说',
  時: '时',
  過: '过',
  還: '还',
  沒: '没',
  麼: '么',
  樣: '样',
  後: '后',
  學: '学',
  開: '开',
  關: '关',
  現: '现',
  點: '点',
  經: '经',
  進: '进',
  動: '动',
  種: '种',
  應: '应',
  員: '员',
  愛: '爱',
  樂: '乐',
  夢: '梦',
  圓: '圆',
  讓: '让',
  話: '话',
  語: '语',
  讀: '读',
  聽: '听',
  見: '见',
  觀: '观',
  覺: '觉',
  親: '亲',
  億: '亿',
  儀: '仪',
  華: '华',
  灣: '湾',
  國: '国',
  園: '园',
  圖: '图',
  團: '团',
  節: '节',
  給: '给',
  紅: '红',
  綠: '绿',
  藍: '蓝',
  黃: '黄',
  銀: '银',
  鐵: '铁',
  鐘: '钟',
  錢: '钱',
  針: '针',
  鋼: '钢',
  錄: '录',
  錯: '错',
  鎮: '镇',
  門: '门',
  間: '间',
  聞: '闻',
  陣: '阵',
  陰: '阴',
  陽: '阳',
  階: '阶',
  際: '际',
  隨: '随',
  險: '险',
  隱: '隐',
  雙: '双',
  雜: '杂',
  雞: '鸡',
  難: '难',
  電: '电',
  靈: '灵',
  靜: '静',
  韓: '韩',
  響: '响',
  頁: '页',
  頭: '头',
  顏: '颜',
  願: '愿',
  類: '类',
  題: '题',
  風: '风',
  飛: '飞',
  飯: '饭',
  養: '养',
  餘: '余',
  館: '馆',
  馬: '马',
  駕: '驾',
  騎: '骑',
  魚: '鱼',
  鳥: '鸟',
  鳴: '鸣',
  麗: '丽',
  麥: '麦',
  齊: '齐',
  齒: '齿',
  龍: '龙',
  龜: '龟',
  萬: '万',
  與: '与',
  專: '专',
  業: '业',
  叢: '丛',
  東: '东',
  絲: '丝',
  丟: '丢',
  兩: '两',
  嚴: '严',
  喪: '丧',
  豐: '丰',
  臨: '临',
  為: '为',
  舉: '举',
  義: '义',
  烏: '乌',
  喬: '乔',
  習: '习',
  鄉: '乡',
  書: '书',
  買: '买',
  亂: '乱',
  爭: '争',
  於: '于',
  虧: '亏',
  雲: '云',
  亞: '亚',
  產: '产',
  僅: '仅',
  從: '从',
  倉: '仓',
  價: '价',
  眾: '众',
  優: '优',
  傷: '伤',
  傳: '传',
  儲: '储',
  兒: '儿',
  黨: '党',
  內: '内',
  寫: '写',
  軍: '军',
  農: '农',
  馮: '冯',
  沖: '冲',
  決: '决',
  況: '况',
  淨: '净',
  涼: '凉',
  減: '减',
  鳳: '凤',
  憑: '凭',
  凱: '凯',
  擊: '击',
  鑿: '凿',
  劃: '划',
  則: '则',
  剛: '刚',
  創: '创',
  刪: '删',
  別: '别',
  劇: '剧',
  劉: '刘',
  劍: '剑',
  劑: '剂',
  務: '务',
  勝: '胜',
  勞: '劳',
  勢: '势',
  勵: '励',
  勸: '劝',
  匯: '汇',
  區: '区',
  協: '协',
  單: '单',
  賣: '卖',
  卻: '却',
  廠: '厂',
  厭: '厌',
  厲: '厉',
  縣: '县',
  參: '参',
  發: '发',
  變: '变',
  敘: '叙',
  疊: '叠',
  隻: '只',
  號: '号',
  嘆: '叹',
  嚇: '吓',
  嗎: '吗',
  噸: '吨',
  啟: '启',
  吳: '吴',
  嘔: '呕',
  嚨: '咙',
  嗆: '呛',
  嗚: '呜',
  噴: '喷',
  嘗: '尝',
  噓: '嘘',
  嗶: '哔',
  噠: '哒',
  喲: '哟',
  嘍: '喽',
  嘮: '唠',
  嘰: '叽',
  嚌: '哜',
  嘜: '唛',
  嗬: '嗬',
  噯: '嗳',
  嚕: '噜',
  噦: '哕',
  嚙: '啮',
  嚦: '呖',
  嘵: '哓',
  嚀: '咛',
  嘖: '啧',
  嚳: '喾',
  嚶: '嘤',
  嚮: '向',
  囈: '呓',
  囑: '嘱',
  圇: '囵',
  圍: '围',
  塊: '块',
  堅: '坚',
  壇: '坛',
  墳: '坟',
  墜: '坠',
  壯: '壮',
  壽: '寿',
  夠: '够',
  夾: '夹',
  奪: '夺',
  奐: '奂',
  獎: '奖',
  奮: '奋',
  妝: '妆',
  婦: '妇',
  媽: '妈',
  媼: '媪',
  嫵: '妩',
  嬈: '娆',
  嬌: '娇',
  嬸: '婶',
  孌: '娈',
  孫: '孙',
  寧: '宁',
  實: '实',
  寵: '宠',
  審: '审',
  寬: '宽',
  寢: '寝',
  對: '对',
  尋: '寻',
  導: '导',
  將: '将',
  爾: '尔',
  塵: '尘',
  堯: '尧',
  盡: '尽',
  層: '层',
  屆: '届',
  屬: '属',
  屢: '屡',
  嶼: '屿',
  歲: '岁',
  豈: '岂',
  峽: '峡',
  嶇: '岖',
  崗: '岗',
  嶄: '崭',
  嶺: '岭',
  嶽: '岳',
  巋: '岿',
  巒: '峦',
  巔: '巅',
  鞏: '巩',
  幣: '币',
  帥: '帅',
  師: '师',
  帳: '帐',
  帶: '带',
  幀: '帧',
  幟: '帜',
  幫: '帮',
  幹: '干',
  廳: '厅',
  廬: '庐',
  庫: '库',
  廟: '庙',
  龐: '庞',
  廢: '废',
  異: '异',
  棄: '弃',
  張: '张',
  彌: '弥',
  彎: '弯',
  彈: '弹',
  強: '强',
  歸: '归',
  當: '当',
  彙: '汇',
  徹: '彻',
  徑: '径',
  復: '复',
  憶: '忆',
  憂: '忧',
  懷: '怀',
  態: '态',
  慫: '怂',
  悵: '怅',
  憐: '怜',
  總: '总',
  戀: '恋',
  懇: '恳',
  惡: '恶',
  慟: '恸',
  懌: '怿',
  慘: '惨',
  慣: '惯',
  慚: '惭',
  憤: '愤',
  憫: '悯',
  懶: '懒',
  懾: '慑',
  戲: '戏',
  戰: '战',
  戶: '户',
  紮: '扎',
  撲: '扑',
  執: '执',
  擴: '扩',
  掃: '扫',
  揚: '扬',
  擾: '扰',
  撫: '抚',
  拋: '抛',
  摳: '抠',
  搶: '抢',
  護: '护',
  報: '报',
  擔: '担',
  擬: '拟',
  攏: '拢',
  揀: '拣',
  擁: '拥',
  攔: '拦',
  撥: '拨',
  擇: '择',
  掛: '挂',
  摯: '挚',
  擻: '擞',
  敵: '敌',
  數: '数',
  斂: '敛',
  斃: '毙',
  晉: '晋',
  晝: '昼',
  暈: '晕',
  暉: '晖',
  暫: '暂',
  曖: '暧',
  曆: '历',
  歷: '历',
  曇: '昙',
  曬: '晒',
  曉: '晓',
  會: '会',
  朧: '胧',
  機: '机',
  極: '极',
  權: '权',
  條: '条',
  楊: '杨',
  構: '构',
  檔: '档',
  標: '标',
  棧: '栈',
  棟: '栋',
  欄: '栏',
  樹: '树',
  檢: '检',
  橋: '桥',
  檜: '桧',
  檸: '柠',
  檻: '槛',
  櫥: '橱',
  欖: '榄',
  欽: '钦',
  歐: '欧',
  歡: '欢',
  殤: '殇',
  殘: '残',
  殮: '殓',
  殯: '殡',
  殲: '歼',
  殺: '杀',
  殼: '壳',
  毀: '毁',
  毆: '殴',
  氣: '气',
  氫: '氢',
  洶: '汹',
  溝: '沟',
  湯: '汤',
  濕: '湿',
  滅: '灭',
  滄: '沧',
  滌: '涤',
  滾: '滚',
  滿: '满',
  濱: '滨',
  濾: '滤',
  濫: '滥',
  灘: '滩',
  災: '灾',
  燦: '灿',
  煬: '炀',
  爐: '炉',
  燉: '炖',
  煉: '炼',
  熾: '炽',
  爍: '烁',
  爛: '烂',
  烴: '烃',
  燒: '烧',
  燙: '烫',
  燜: '焖',
  營: '营',
  燈: '灯',
  燴: '烩',
  燼: '烬',
  燾: '焘',
  爺: '爷',
  犧: '牺',
  狀: '状',
  狹: '狭',
  獅: '狮',
  獨: '独',
  獰: '狞',
  獵: '猎',
  獻: '献',
  獸: '兽',
  瑪: '玛',
  瑋: '玮',
  環: '环',
  璽: '玺',
  瓊: '琼',
  瓏: '珑',
  畢: '毕',
  疇: '畴',
  痙: '痉',
  療: '疗',
  癘: '疠',
  癩: '癞',
  癬: '癣',
  盤: '盘',
  監: '监',
  盜: '盗',
  盞: '盏',
  盧: '卢',
  盪: '荡',
  睜: '睁',
  瞞: '瞒',
  矯: '矫',
  磯: '矶',
  礎: '础',
  礙: '碍',
  礦: '矿',
  磚: '砖',
  禮: '礼',
  禍: '祸',
  禪: '禅',
  離: '离',
  稱: '称',
  穀: '谷',
  積: '积',
  穎: '颖',
  穩: '稳',
  穫: '获',
  穢: '秽',
  竊: '窃',
  竅: '窍',
  窩: '窝',
  窮: '穷',
  窯: '窑',
  窺: '窥',
  竈: '灶',
  競: '竞',
  筆: '笔',
  筍: '笋',
  築: '筑',
  篤: '笃',
  簍: '篓',
  篩: '筛',
  簡: '简',
  簫: '箫',
  籃: '篮',
  籌: '筹',
  籠: '笼',
  籟: '籁',
  籤: '签',
  籬: '篱',
  籲: '吁',
  粵: '粤',
  糧: '粮',
  糞: '粪',
  紀: '纪',
  約: '约',
  級: '级',
  紋: '纹',
  納: '纳',
  紐: '纽',
  純: '纯',
  紗: '纱',
  綱: '纲',
  紙: '纸',
  紛: '纷',
  紡: '纺',
  細: '细',
  紳: '绅',
  組: '组',
  終: '终',
  結: '结',
  絕: '绝',
  絞: '绞',
  絡: '络',
  絨: '绒',
  統: '统',
  綁: '绑',
  綜: '综',
  綢: '绸',
  維: '维',
  網: '网',
  綴: '缀',
  綺: '绮',
  綻: '绽',
  緊: '紧',
  緒: '绪',
  線: '线',
  緝: '缉',
  緞: '缎',
  締: '缔',
  緣: '缘',
  編: '编',
  緩: '缓',
  緬: '缅',
  緯: '纬',
  練: '练',
  緻: '致',
  縈: '萦',
  縛: '缚',
  縫: '缝',
  縮: '缩',
  縱: '纵',
  縷: '缕',
  績: '绩',
  繃: '绷',
  織: '织',
  繕: '缮',
  繚: '缭',
  繞: '绕',
  繡: '绣',
  繩: '绳',
  繪: '绘',
  繫: '系',
  繭: '茧',
  繳: '缴',
  續: '续',
  纏: '缠',
  纓: '缨',
  纖: '纤',
  罰: '罚',
  罷: '罢',
  羅: '罗',
  羈: '羁',
  翹: '翘',
  聳: '耸',
  恥: '耻',
  聶: '聂',
  聾: '聋',
  職: '职',
  聯: '联',
  聰: '聪',
  肅: '肃',
  腸: '肠',
  膚: '肤',
  膽: '胆',
  脅: '胁',
  脈: '脉',
  脹: '胀',
  腎: '肾',
  腫: '肿',
  腳: '脚',
  膿: '脓',
  臉: '脸',
  臍: '脐',
  臘: '腊',
  臟: '脏',
  臥: '卧',
  舊: '旧',
  艙: '舱',
  艦: '舰',
  艱: '艰',
  艷: '艳',
  蘇: '苏',
  蓮: '莲',
  薈: '荟',
  薦: '荐',
  薩: '萨',
  藥: '药',
  藺: '蔺',
  蘆: '芦',
  虛: '虚',
  蟲: '虫',
  蟬: '蝉',
  蟻: '蚁',
  蠅: '蝇',
  蠍: '蝎',
  蠟: '蜡',
  銜: '衔',
  補: '补',
  襯: '衬',
  襖: '袄',
  襪: '袜',
  襲: '袭',
  規: '规',
  覓: '觅',
  視: '视',
  覽: '览',
  觴: '觞',
  觸: '触',
  訂: '订',
  計: '计',
  訊: '讯',
  討: '讨',
  訓: '训',
  記: '记',
  訛: '讹',
  訪: '访',
  設: '设',
  許: '许',
  訴: '诉',
  診: '诊',
  註: '注',
  詐: '诈',
  詞: '词',
  詠: '咏',
  詢: '询',
  試: '试',
  詩: '诗',
  詬: '诟',
  詭: '诡',
  詮: '诠',
  詰: '诘',
  該: '该',
  詳: '详',
  誆: '诓',
  誅: '诛',
  誇: '夸',
  誌: '志',
  認: '认',
  誕: '诞',
  誘: '诱',
  誠: '诚',
  誤: '误',
  誦: '诵',
  誰: '谁',
  課: '课',
  誹: '诽',
  誼: '谊',
  調: '调',
  談: '谈',
  請: '请',
  諒: '谅',
  論: '论',
  諜: '谍',
  諢: '诨',
  諦: '谛',
  諧: '谐',
  諷: '讽',
  諸: '诸',
  諺: '谚',
  諾: '诺',
  謀: '谋',
  謂: '谓',
  謊: '谎',
  謎: '谜',
  謐: '谧',
  謗: '谤',
  謙: '谦',
  講: '讲',
  謝: '谢',
  謠: '谣',
  謬: '谬',
  謹: '谨',
  證: '证',
  譏: '讥',
  識: '识',
  譚: '谭',
  譜: '谱',
  議: '议',
  譯: '译',
  譽: '誉',
  讒: '谗',
  豬: '猪',
  貓: '猫',
  貝: '贝',
  貞: '贞',
  負: '负',
  財: '财',
  貢: '贡',
  貧: '贫',
  貨: '货',
  販: '贩',
  貪: '贪',
  貫: '贯',
  責: '责',
  貳: '贰',
  貴: '贵',
  貶: '贬',
  貸: '贷',
  費: '费',
  貼: '贴',
  貿: '贸',
  賀: '贺',
  賃: '赁',
  賄: '贿',
  資: '资',
  賈: '贾',
  賊: '贼',
  賓: '宾',
  賜: '赐',
  賞: '赏',
  賠: '赔',
  賢: '贤',
  賤: '贱',
  賦: '赋',
  質: '质',
  賬: '账',
  賭: '赌',
  賴: '赖',
  賺: '赚',
  購: '购',
  賽: '赛',
  贅: '赘',
  贈: '赠',
  贊: '赞',
  贏: '赢',
  贓: '赃',
  贖: '赎',
  趕: '赶',
  趙: '赵',
  趨: '趋',
  躍: '跃',
  踐: '践',
  蹺: '跷',
  躋: '跻',
  踴: '踊',
  躊: '踌',
  躑: '踯',
  躡: '蹑',
  躥: '蹿',
  躪: '躏',
  軀: '躯',
  車: '车',
  軋: '轧',
  軌: '轨',
  軒: '轩',
  軟: '软',
  軸: '轴',
  較: '较',
  載: '载',
  輔: '辅',
  輕: '轻',
  輛: '辆',
  輜: '辎',
  輝: '辉',
  輟: '辍',
  輥: '辊',
  輩: '辈',
  輪: '轮',
  輯: '辑',
  輸: '输',
  輾: '辗',
  轄: '辖',
  轅: '辕',
  轉: '转',
  轍: '辙',
  轎: '轿',
  轟: '轰',
  辦: '办',
  辭: '辞',
  辯: '辩',
  辮: '辫',
  適: '适',
  選: '选',
  遜: '逊',
  遞: '递',
  遙: '遥',
  遲: '迟',
  遷: '迁',
  遺: '遗',
  邁: '迈',
  邊: '边',
  邏: '逻',
  郵: '邮',
  鄒: '邹',
  鄭: '郑',
  鄧: '邓',
  醞: '酝',
  醬: '酱',
  釀: '酿',
  釋: '释',
  裏: '里',
  鑑: '鉴',
  釘: '钉',
  釗: '钊',
  釣: '钓',
  鈣: '钙',
  鈦: '钛',
  鈍: '钝',
  鈔: '钞',
  鈉: '钠',
  鑰: '钥',
  鈞: '钧',
  鈎: '钩',
  鈕: '钮',
  鉗: '钳',
  鈷: '钴',
  鑽: '钻',
  鉬: '钼',
  鉀: '钾',
  鈾: '铀',
  鉑: '铂',
  鈴: '铃',
  鉛: '铅',
  鉚: '铆',
  銬: '铐',
  鋒: '锋',
  鋅: '锌',
  錒: '锕',
  錛: '锛',
  錮: '锢',
  錘: '锤',
  錐: '锥',
  錦: '锦',
  錠: '锭',
  鍵: '键',
  鋸: '锯',
  錳: '锰',
  鍛: '锻',
  鎖: '锁',
  鎧: '铠',
  鎬: '镐',
  鎊: '镑',
  鏈: '链',
  鏗: '铿',
  鏢: '镖',
  鏜: '镗',
  鏝: '镘',
  鏞: '镛',
  鏟: '铲',
  鏡: '镜',
  鏤: '镂',
  鏃: '镞',
  鏇: '镟',
  鏑: '镝',
  鏘: '锵',
  鐦: '锎',
  鐐: '镣',
  鐓: '镦',
  鐨: '镄',
  鐫: '镌',
  鐮: '镰',
  鐲: '镯',
  鐳: '镭',
  鐶: '镮',
  鑄: '铸',
  鑊: '镬',
  鑌: '镔',
  鑞: '镴',
  鑠: '铄',
  鑣: '镳',
  鑭: '镧',
  鑲: '镶',
  鑷: '镊',
  鑼: '锣',
  長: '长',
  閂: '闩',
  閃: '闪',
  閉: '闭',
  問: '问',
  闖: '闯',
  閏: '闰',
  閑: '闲',
  閔: '闵',
  閘: '闸',
  閣: '阁',
  閥: '阀',
  閨: '闺',
  閩: '闽',
  閱: '阅',
  閹: '阉',
  閾: '阈',
  閻: '阎',
  闊: '阔',
  闌: '阑',
  闈: '闱',
  闋: '阕',
  闔: '阖',
  闕: '阙',
  闞: '阚',
  陘: '陉',
  陝: '陕',
  陸: '陆',
  陳: '陈',
  隉: '陧',
  隸: '隶',
  雋: '隽',
  雛: '雏',
  靂: '雳',
  霧: '雾',
  霽: '霁',
  靄: '霭',
  靚: '靓',
  靨: '靥',
  韃: '鞑',
  韁: '缰',
  韋: '韦',
  韌: '韧',
  韜: '韬',
  頂: '顶',
  頃: '顷',
  項: '项',
  順: '顺',
  須: '须',
  頑: '顽',
  顧: '顾',
  頓: '顿',
  預: '预',
  頒: '颁',
  頌: '颂',
  頗: '颇',
  領: '领',
  頜: '颌',
  頡: '颉',
  頤: '颐',
  頦: '颏',
  頰: '颊',
  頷: '颔',
  頸: '颈',
  頹: '颓',
  頻: '频',
  顆: '颗',
  顒: '颙',
  顎: '颚',
  顓: '颛',
  額: '额',
  顳: '颞',
  顛: '颠',
  顙: '颡',
  顥: '颢',
  顫: '颤',
  顯: '显',
  顰: '颦',
  顱: '颅',
  颭: '飐',
  颮: '飑',
  颯: '飒',
  颱: '台',
  颳: '刮',
  颶: '飓',
  颸: '飔',
  颺: '飏',
  颼: '飕',
  飄: '飘',
  飆: '飙',
  飢: '饥',
  飩: '饨',
  飪: '饪',
  飫: '饫',
  飭: '饬',
  飲: '饮',
  飴: '饴',
  飼: '饲',
  飽: '饱',
  飾: '饰',
  餃: '饺',
  餅: '饼',
  餌: '饵',
  餒: '馁',
  餓: '饿',
  餚: '肴',
  餛: '馄',
  餞: '饯',
  餡: '馅',
  餵: '喂',
  餾: '馏',
  餿: '馊',
  饃: '馍',
  饅: '馒',
  饉: '馑',
  饋: '馈',
  饌: '馔',
  饒: '饶',
  饗: '飨',
  饞: '馋',
  饢: '馕',
  馭: '驭',
  馱: '驮',
  馴: '驯',
  馳: '驰',
  駁: '驳',
  駐: '驻',
  駝: '驼',
  駒: '驹',
  駛: '驶',
  騁: '骋',
  騏: '骐',
  駱: '骆',
  駭: '骇',
  騖: '骛',
  騙: '骗',
  騫: '骞',
  騰: '腾',
  騷: '骚',
  騾: '骡',
  驀: '蓦',
  驁: '骜',
  驂: '骖',
  驄: '骢',
  驅: '驱',
  驊: '骅',
  驍: '骁',
  驕: '骄',
  驗: '验',
  驚: '惊',
  驛: '驿',
  驟: '骤',
  驢: '驴',
  驥: '骥',
  驤: '骧',
  驪: '骊',
  髏: '髅',
  髒: '脏',
  體: '体',
  髕: '髌',
  髖: '髋',
  髮: '发',
  鬆: '松',
  鬍: '胡',
  鬚: '须',
  鬢: '鬓',
  鬥: '斗',
  鬧: '闹',
  鬨: '哄',
  鬱: '郁',
  魎: '魉',
  魘: '魇',
  魯: '鲁',
  魴: '鲂',
  魷: '鱿',
  鮑: '鲍',
  鮮: '鲜',
  鯉: '鲤',
  鯇: '鲩',
  鯽: '鲫',
  鯨: '鲸',
  鯪: '鲮',
  鯰: '鲶',
  鯿: '鳊',
  鰈: '鲽',
  鰉: '鳇',
  鰍: '鳅',
  鰐: '鳄',
  鰓: '鳃',
  鰛: '鳜',
  鰟: '鳑',
  鰣: '鲥',
  鰥: '鳏',
  鰨: '鳎',
  鰩: '鳐',
  鰭: '鳍',
  鰱: '鲢',
  鰲: '鳌',
  鰳: '鳓',
  鰹: '鲣',
  鰻: '鳗',
  鱅: '鳙',
  鱈: '鳕',
  鱉: '鳖',
  鱒: '鳟',
  鱔: '鳝',
  鱖: '鳜',
  鱗: '鳞',
  鱘: '鲟',
  鱠: '鲙',
  鱧: '鳢',
  鱷: '鳄',
  鱸: '鲈',
  鳩: '鸠',
  鳶: '鸢',
  鴉: '鸦',
  鴕: '鸵',
  鴛: '鸳',
  鴝: '鸲',
  鴞: '鸮',
  鴣: '鸪',
  鴦: '鸯',
  鴨: '鸭',
  鴻: '鸿',
  鴿: '鸽',
  鵑: '鹃',
  鵜: '鹈',
  鵝: '鹅',
  鵠: '鹄',
  鵡: '鹉',
  鵬: '鹏',
  鵲: '鹊',
  鶇: '鸫',
  鶉: '鹑',
  鶘: '鹕',
  鶚: '鹗',
  鶡: '鹖',
  鶥: '鹛',
  鶩: '鹜',
  鶯: '莺',
  鶴: '鹤',
  鶻: '鹘',
  鷂: '鹞',
  鷄: '鸡',
  鷓: '鹧',
  鷗: '鸥',
  鷚: '鹨',
  鷥: '鸶',
  鷦: '鹪',
  鷲: '鹫',
  鷺: '鹭',
  鷹: '鹰',
  鸚: '鹦',
  鸛: '鹳',
  鸝: '鹂',
  鸞: '鸾',
  鹵: '卤',
  鹹: '咸',
  鹼: '碱',
  鹽: '盐',
  麩: '麸',
  麵: '面',
  黌: '黉',
  黲: '黪',
  黴: '霉',
  黷: '黩',
  黽: '黾',
  黿: '鼋',
  鼂: '鼌',
  鼉: '鼍',
  鼕: '冬',
  鼴: '鼹',
  齋: '斋',
  齎: '赍',
  齔: '龀',
  齕: '龁',
  齙: '龅',
  齜: '龇',
  齟: '龃',
  齠: '龆',
  齡: '龄',
  齣: '出',
  齦: '龈',
  齪: '龊',
  齲: '龋',
  齷: '龌',
  龔: '龚',
  龕: '龛',
}

/** 繁简转换用的匹配模式（一次性编译，避免每次归一化重复构造） */
const TRADITIONAL_PATTERN = new RegExp(Object.keys(TRADITIONAL_TO_SIMPLIFIED).join('|'), 'g')

/** 实测占位文件固定为 185,336 B（≈11.57s @128k），与请求歌曲无关 */
const PLACEHOLDER_MAX_BYTES = 190000

/** 预期体积超过该值时才启用占位文件特征判定，避免误伤极短曲目 */
const PLACEHOLDER_MIN_EXPECTED_BYTES = 300000

/**
 * 「体积明显偏小」判定采用的码率下界（kbps）
 *
 * 站外源声明的码率未必是直链的真实码率（同一首歌在不同通道可能是 64k / 128k / 320k），
 * 按 128k 估算会把 64k 及以下的正常文件误判成残缺文件。
 * 这里改用最低合理码率下界估算，残缺文件仍由占位文件特征与长曲目字节下限拦截。
 */
const MIN_PLAUSIBLE_BITRATE_KBPS = 32

/** 体积下限：声明时长超过 LONG_DURATION_SECONDS 的歌曲，文件不可能小于该字节数 */
const MIN_PLAUSIBLE_BYTES = 100000

/** 触发体积下限校验的时长阈值（秒） */
const LONG_DURATION_SECONDS = 60

/**
 * 解码 HTML 实体（搜索页与详情页的歌手字段带实体转义）
 * @param text 原始文本
 * @returns 解码后的文本
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

/**
 * 把繁体字转换为简体字
 * @param text 原始文本
 * @returns 转换后的文本
 */
const toSimplified = (text: string): string =>
  text.replace(TRADITIONAL_PATTERN, (char) => TRADITIONAL_TO_SIMPLIFIED[char] ?? char)

/**
 * 去掉括号内的补充说明，得到主标题
 * @param text 原始标题
 * @returns 去掉括号内容后的标题
 */
const stripBrackets = (text: string): string =>
  text.replace(/[（(【[《][^）)】\]》]*[）)】\]》]/g, ' ')

/**
 * 去掉圆括号 / 方括号 / 六角括号内容，但保留书名号《》里的主标题
 *
 * 中文歌名用《》包裹主标题是常见写法（「《春娇与志明》：街道办GDC、欧阳耀莹」），
 * 连《》一起剥掉会把主标题删光，只剩歌手信息。
 * @param text 原始标题
 * @returns 保留书名号内容的标题
 */
const stripSquareBrackets = (text: string): string =>
  text.replace(/[（(【[][^）)】\]]*[）)】\]]/g, ' ')

/**
 * 归一化：解码实体、繁转简、转小写、去除标点与空白，仅保留字母、数字与汉字
 * @param text 原始文本
 * @returns 归一化后的文本
 */
export const normalizeText = (text: string): string =>
  toSimplified(decodeEntities(text || ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * 计算编辑距离
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 编辑距离
 */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = current
  }
  return prev[b.length]
}

/**
 * 计算两个字符串的相似度
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 0~1 的相似度
 */
const textSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 0 : 1 - levenshtein(a, b) / longest
}

/**
 * 取出歌名的比对形态
 *
 * 两种形态：剥离全部括号内容的主标题形态、保留书名号《》内容的形态。
 * @param title 原始歌名
 * @returns 归一化后的形态列表
 */
const titleForms = (title: string): string[] =>
  [normalizeText(stripBrackets(title)), normalizeText(stripSquareBrackets(title))].filter(Boolean)

/**
 * 取出候选歌名中「请求歌名之外」的剩余文本
 *
 * 站外源常把歌手写进歌名字段（「春娇与志明 街道办GDC / 欧阳耀莹」、
 * 「《春娇与志明》：街道办GDC、欧阳耀莹」），这段剩余文本有两个用途：
 * 判定「候选歌名包含请求歌名」（子串分），以及扫描版本标记（翻自 / 翻奏 / rmx 等）。
 * @param requestTitle 请求歌名
 * @param candidateTitle 候选歌名
 * @returns 归一化后的剩余文本；候选歌名不含请求歌名时返回空串
 */
export const extractEmbeddedText = (requestTitle: string, candidateTitle: string): string => {
  const requestNorm = normalizeText(requestTitle)
  const candidateNorm = normalizeText(candidateTitle)
  if (!requestNorm || !candidateNorm) return ''
  const index = candidateNorm.indexOf(requestNorm)
  if (index < 0) return ''
  return candidateNorm.slice(0, index) + candidateNorm.slice(index + requestNorm.length)
}

/**
 * 判断候选歌名是否只是同一首歌的「其他版本」
 * @param candidateTitle 候选歌名
 * @param requestTitle 请求歌名
 * @param embeddedText 候选歌名中超出请求歌名的剩余文本
 * @returns 命中版本标记时为 true
 */
const isVersionVariant = (
  candidateTitle: string,
  requestTitle: string,
  embeddedText = '',
): boolean => {
  const requestNorm = normalizeText(requestTitle)
  const segments: string[] = []
  const bracket = /[（(【[《]([^）)】\]》]*)[）)】\]》]/g
  let matched: RegExpExecArray | null
  while ((matched = bracket.exec(candidateTitle))) segments.push(matched[1])
  const tail = candidateTitle.split(/[-|_]/).pop() ?? ''
  if (tail && tail !== candidateTitle.trim()) segments.push(tail)
  if (embeddedText) segments.push(embeddedText)
  return segments.some((segment) => {
    const norm = normalizeText(segment)
    if (!norm) return false
    return VERSION_MARKERS.some((marker) => {
      const normalized = normalizeText(marker)
      return norm.includes(normalized) && !requestNorm.includes(normalized)
    })
  })
}

/**
 * 计算歌名相似度
 *
 * 取多种形态里的最高分：
 * 1. 主标题形态（剥离全部括号内容）的编辑距离相似度；
 * 2. 保留书名号《》内容的形态的编辑距离相似度 —— 剥离《》会把主标题一起删掉；
 * 3. 子串分 —— 候选歌名包含请求歌名时视为同一首歌（站外源常把歌手写进歌名字段，
 *    如「春娇与志明 街道办GDC / 欧阳耀莹」）。
 *
 * 歌名分只回答「是不是同一首歌」，版本对不对由歌手维度把关：
 * 歌名里内嵌了原唱歌手，不代表候选就是原唱（搬运版 / 翻唱版的歌名里同样写着原唱）。
 *
 * 命中版本变体标记时整体折半。
 * @param requestTitle 请求歌名
 * @param candidateTitle 候选歌名
 * @returns 0~1 的相似度
 */
export const titleSimilarity = (requestTitle: string, candidateTitle: string): number => {
  const requestForms = titleForms(requestTitle)
  const candidateForms = titleForms(candidateTitle)
  if (!requestForms.length || !candidateForms.length) return 0
  let base = 0
  for (const requestForm of requestForms) {
    for (const candidateForm of candidateForms) {
      base = Math.max(base, textSimilarity(requestForm, candidateForm))
    }
  }
  const embeddedText = extractEmbeddedText(requestTitle, candidateTitle)
  if (embeddedText) base = 1
  if (isVersionVariant(candidateTitle, requestTitle, embeddedText)) return base * 0.5
  return base
}

/**
 * 计算歌手相似度
 *
 * 请求侧没有歌手信息时返回 0（不放行）：空歌手退化为纯歌名匹配会命中同名不同版本的曲目
 * （实测《青花瓷》仅按歌名检索会命中 95 秒的街声版），
 * 宁可换源失败也不播错歌。
 *
 * 只认候选的**歌手栏位**：站外源常把原唱写进歌名字段、把搬运者 / 翻唱者写进歌手栏位
 * （「春娇与志明 街道办GDC / 欧阳耀莹」+ 歌手「A12」「青柠」「RYO凉夜 / MIYA米娅」），
 * 若因歌名里出现原唱就放行歌手维度，播出来的就是搬运版或翻唱版。
 * 参照网易云平台的解锁口径：网易云歌曲按 id 精确寻址，命中即原曲；
 * 走到模糊检索的站外源时同样要求歌手栏位严格命中。
 *
 * 只有**主歌手**（候选歌手栏位的第一位）命中才给满分：副歌手（合作 / feat）单独命中
 * 说明候选是别人的版本，按 Jaccard 口径计分并压到 ARTIST_SCORE_LIMIT 之下。
 * @param requestArtist 请求歌手
 * @param candidateArtist 候选歌手
 * @returns 0~1 的相似度
 */
export const artistSimilarity = (requestArtist: string, candidateArtist: string): number => {
  const request = normalizeText(requestArtist)
  if (!request) return 0
  const tokens = (candidateArtist || '')
    .split(ARTIST_SEPARATOR)
    .map((token) => normalizeText(token))
    .filter(Boolean)
  if (!tokens.length) return 0
  const requestTokens = requestArtist
    .split(ARTIST_SEPARATOR)
    .map((token) => normalizeText(token))
    .filter(Boolean)
  const primary = tokens[0]
  if (
    primary &&
    requestTokens.some((token) => primary.includes(token) || token.includes(primary))
  ) {
    return 1
  }
  const candidateSet = new Set(tokens)
  let intersection = 0
  for (const token of requestTokens) {
    if (candidateSet.has(token)) intersection += 1
  }
  const union = new Set([...tokens, ...requestTokens]).size
  const jaccard = union === 0 ? 0 : intersection / union
  return Math.min(jaccard, SECONDARY_ARTIST_SCORE)
}

/**
 * 计算时长容差：max(8 秒, 6%)
 * @param duration 期望时长（秒）
 * @returns 容差（秒）
 */
export const durationTolerance = (duration: number): number => Math.max(8, duration * 0.06)

/**
 * 计算时长接近度，超出容差记 0 分
 * @param candidateDuration 候选时长（秒）
 * @param requestDuration 请求时长（秒）
 * @returns 0~1 的接近度；无法比对时返回 null
 */
export const durationSimilarity = (
  candidateDuration?: number,
  requestDuration?: number,
): number | null => {
  if (!requestDuration || !Number.isFinite(requestDuration) || requestDuration <= 0) return null
  if (!candidateDuration || !Number.isFinite(candidateDuration) || candidateDuration <= 0)
    return null
  const tolerance = durationTolerance(requestDuration)
  const delta = Math.abs(candidateDuration - requestDuration)
  if (delta > tolerance) return 0
  return 1 - delta / tolerance
}

/**
 * 对单个候选做三重校验
 * @param candidate 候选歌曲
 * @param target 请求侧目标
 * @returns 校验明细与综合得分
 */
export const scoreCandidate = (candidate: MatchCandidate, target: MatchTarget): CandidateScore => {
  const titleScore = titleSimilarity(target.title, candidate.title)
  const artistScore = artistSimilarity(target.artist, candidate.artist)
  const durationScore = durationSimilarity(candidate.duration, target.duration)
  const passed =
    titleScore >= TITLE_SCORE_LIMIT &&
    artistScore >= ARTIST_SCORE_LIMIT &&
    (durationScore === null || durationScore > 0)
  const score =
    TITLE_WEIGHT * titleScore +
    ARTIST_WEIGHT * artistScore +
    DURATION_WEIGHT * (durationScore === null ? 1 : durationScore)
  return { candidate, titleScore, artistScore, durationScore, score, passed }
}

/**
 * 对候选列表排序：通过校验的优先，其次按综合得分降序，同分保持检索顺序
 * @param candidates 候选列表
 * @param target 请求侧目标
 * @returns 排序后的校验明细
 */
export const rankCandidates = (
  candidates: MatchCandidate[],
  target: MatchTarget,
): CandidateScore[] =>
  candidates
    .map((candidate, index) => ({ index, detail: scoreCandidate(candidate, target) }))
    .sort((a, b) => {
      if (a.detail.passed !== b.detail.passed) return a.detail.passed ? -1 : 1
      if (b.detail.score !== a.detail.score) return b.detail.score - a.detail.score
      return a.index - b.index
    })
    .map((item) => item.detail)

/**
 * 取出排序后首个通过三重校验的候选
 * @param candidates 候选列表
 * @param target 请求侧目标
 * @returns 通过校验的候选；无则返回 null
 */
export const pickBestCandidate = (
  candidates: MatchCandidate[],
  target: MatchTarget,
): MatchCandidate | null =>
  rankCandidates(candidates, target).find((detail) => detail.passed)?.candidate ?? null

/**
 * 解析 keyword：按最后一个「-」拆出歌名与歌手，并去掉首尾空白
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @returns 歌名与歌手
 */
export const parseKeyword = (keyword: string): { title: string; artist: string } => {
  const text = (keyword || '').trim()
  const index = text.lastIndexOf('-')
  if (index > 0) {
    const title = text.slice(0, index).trim()
    const artist = text.slice(index + 1).trim()
    if (title && artist) return { title, artist }
  }
  return { title: text, artist: '' }
}

/**
 * 解析可选的时长参数
 * @param value 秒数的字符串或数字
 * @returns 合法时长；不合法时返回 undefined
 */
export const parseDurationParam = (value?: string | number): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

/**
 * 构造请求侧目标信息
 * @param keyword 形如「歌名 - 歌手」的关键词
 * @param duration 期望时长（秒），可选
 * @returns 目标信息
 */
export const buildTarget = (keyword: string, duration?: number): MatchTarget => {
  const { title, artist } = parseKeyword(keyword)
  return {
    title,
    artist,
    duration: parseDurationParam(duration),
  }
}

/**
 * 估算指定码率与时长应有的文件体积
 * @param duration 时长（秒）
 * @param bitrateKbps 码率（kbps）
 * @returns 预期字节数
 */
export const expectedAudioBytes = (duration: number, bitrateKbps: number): number =>
  Math.round((duration * bitrateKbps * 1000) / 8)

/**
 * 判断直链返回的文件体积是否符合预期，用于拦截占位/残缺文件
 *
 * 体积探测失败（长度未知）不再等同于「校验通过」：此时返回未验证标记，
 * 由调用方决定是否继续使用该直链；候选缺时长时退化为「字节下限」粗校验。
 * @param length 响应头声明的字节数；未知时为 null
 * @param duration 候选歌曲声明的时长（秒）
 * @param bitrateKbps 直链码率（kbps）
 * @param targetDuration 请求侧声明的时长（秒），可选，用于字节下限粗校验
 * @returns 是否可用、判定理由与体积校验是否完成
 */
export const isPlausibleAudioLength = (
  length: number | null,
  duration?: number,
  bitrateKbps = 128,
  targetDuration?: number,
): { ok: boolean; reason: string; verified: boolean } => {
  if (length === null) {
    return { ok: true, verified: false, reason: '长度探测失败，未能完成体积校验' }
  }
  if (!duration || duration <= 0) {
    if (targetDuration && targetDuration > LONG_DURATION_SECONDS) {
      if (length <= PLACEHOLDER_MAX_BYTES) {
        return {
          ok: false,
          verified: true,
          reason: `体积 ${length}B 命中占位文件特征（≤${PLACEHOLDER_MAX_BYTES}B）`,
        }
      }
      if (length < MIN_PLAUSIBLE_BYTES) {
        return {
          ok: false,
          verified: true,
          reason: `体积 ${length}B 小于 ${targetDuration}s 长曲目的体积下限 ${MIN_PLAUSIBLE_BYTES}B`,
        }
      }
      return { ok: true, verified: true, reason: '候选无时长，已按字节下限校验' }
    }
    return { ok: true, verified: false, reason: '候选与请求均无时长，无法完成体积校验' }
  }
  const expected = expectedAudioBytes(duration, bitrateKbps)
  const floorExpected = expectedAudioBytes(duration, MIN_PLAUSIBLE_BITRATE_KBPS)
  if (length < floorExpected * 0.5) {
    return {
      ok: false,
      verified: true,
      reason: `体积 ${length}B 明显小于 ${duration}s@${MIN_PLAUSIBLE_BITRATE_KBPS}k 的预期 ${floorExpected}B`,
    }
  }
  if (length <= PLACEHOLDER_MAX_BYTES && expected > PLACEHOLDER_MIN_EXPECTED_BYTES) {
    return {
      ok: false,
      verified: true,
      reason: `体积 ${length}B 命中占位文件特征（≤${PLACEHOLDER_MAX_BYTES}B）`,
    }
  }
  return { ok: true, verified: true, reason: '' }
}
