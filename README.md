# 车来了 API 整理

基于以下两份资料整理，并补充了 2026-03-18 对新版 H5 网页端的实测结果：

- [Youngxj: PHP 车来了 API 获取公交车信息](https://blog.youngxj.cn/593.html)
- [Ancientwood Gist: chelaile](https://gist.github.com/Ancientwood/774898f4a3fac8a36dad3c466d4e4fdd)

本文档分两部分：

- 第一部分是旧资料里的历史接口，便于对照
- 第二部分是目前仍可工作的新版 H5 接口、签名和解密方法

## 说明

- 非官方公开文档，仅供个人学习使用，请勿用于牟利。
- 参数、签名、版本号、返回结构都可能继续变化。
- 请仅在合法、合规、低频的前提下使用，避免对第三方服务造成影响。
- 截至 2026-03-18，旧版 App 接口大多已被版本校验拦截，但新版 H5 网页接口仍可用。

## 当前测试

- 旧资料中的 `citylist` 仍可用。
- 旧资料中的 `stop!homePageInfo.action`、`line!lineDetail.action` 等 App 接口会返回 `12009`，提示版本已不提供服务，但版本号参数修改为最新的`7.1.0`仍返回此结果，姑且认为是此接口已停用。
- 新版 H5 网页接口仍可调用，核心接口变为：
  - `GET /api/bus/cityLineList`
  - `GET /api/bus/line!lineRoute.action`
  - `GET /api/bus/stop!encryptedNearlines.action`
  - `GET /api/bus/line!encryptedLineDetail.action`
  - `GET /api/bus/line!encryptedTsfRealInfos.action`
  - `GET /api/bus/line!busList.action`
  - `GET /api/bus/line!busDetailByBusId.action`
  - `GET /api/bus/line!depTimeTable.action`

## 调用流程

目前可行的调用顺序是：

1. 根据经纬度查询 `cityId`
2. 根据城市和线路名查询线路列表，拿到 `lineId`
3. 根据 `lineId` 查询线路站点列表，定位目标站的 `targetOrder`
4. 调用加密详情接口，拿到 `encryptResult`
5. 用前端同款 AES 规则解密，得到明文 JSON

## 一、旧资料中的历史接口

这一部分主要保留原始资料中的接口和参数，便于对照。

### 1. 获取城市信息

**URL**

```text
https://web.chelaile.net.cn/cdatasource/citylist
```

**方法**

`GET`

**示例参数**

```text
type=gpsRealtimeCity
lat=29.868336
lng=121.544625
gpstype=wgs
s=android
v=3.80.0
src=webapp_default
userId=
```

**成功标志**

- `status == "OK"`

**关注字段**

- `data.gpsRealtimeCity.cityId`
- `data.gpsRealtimeCity.name`

### 2. 获取附近站点和线路

**URL**

```text
https://api.chelaile.net.cn/bus/stop!homePageInfo.action
```

**说明**

截至 2026-03-18，此接口实测返回：

```json
{"jsonr":{"data":{},"errmsg":"该版本已不提供服务，请前往应用市场升级至最新版","status":"12009","success":false}}
```

### 3. 获取线路实时信息

**URL**

```text
http://api.chelaile.net.cn/bus/line!lineDetail.action
```

**说明**

截至 2026-03-18，此接口同样会返回 `12009`。

### 4. 获取车辆详情

**URL**

```text
http://api.chelaile.net.cn/bus/line!busesDetail.action
```

**说明**

未知

### 5. 获取发车时刻表

**URL**

```text
http://api.chelaile.net.cn/bus/line!depTimeTable.action
```

**说明**

旧资料中可用，但建议优先使用新版网页接口。

### 旧版返回值处理

旧资料里部分接口不是纯 JSON，而是：

```text
YGKJ##...**YGKJ
```

需要进行decode

处理方式：

```php
$data = str_replace(array("YGKJ##", "**YGKJ"), "", $data_json);
$json = json_decode($data, true);
```

## 二、新版 H5 网页接口

### 特征

- 域名：`https://web.chelaile.net.cn`，不再通过`api.chelaile.net.cn`
- 路径前缀：`/api/`
- 客户端标识：`s=h5`
- 当前抓到的版本：`v=9.1.2`
- 常见共享参数：
  - `s=h5`
  - `v=9.1.2`
  - `vc=1`
  - `src=wechat_shaoguan`
  - `userId=browser_xxx`
  - `h5Id=browser_xxx`
  - `sign=1`
  - `cityId`
  - `geo_lat`
  - `geo_lng`
  - `lat`
  - `lng`
  - `gpstype=wgs`

### 1. 查询城市线路列表

用于根据线路名查 `lineId`。

**URL**

```text
https://web.chelaile.net.cn/api/bus/cityLineList
```

**方法**

`GET`

**常见参数**

```text
cityId=241
lineName=7
s=h5
v=9.1.2
vc=1
src=wechat_shaoguan
userId=browser_xxx
h5Id=browser_xxx
sign=1
```

**用途**

- 根据 `cityId + lineName` 查询同名线路的双向信息
- 从结果中提取 `lineId`、起终点、方向

### 2. 查询线路站点列表

用于根据 `lineId` 查站点顺序，定位目标站的 `targetOrder`。

**URL**

```text
https://web.chelaile.net.cn/api/bus/line!lineRoute.action
```

**方法**

`GET`

**常见参数**

```text
lineId=0751131909628
cityId=241
s=h5
v=9.1.2
vc=1
src=wechat_shaoguan
userId=browser_xxx
h5Id=browser_xxx
sign=1
```

**用途**

- 查询整条线的站点序列
- 找到目标站的顺序 `targetOrder`
- 同时拿到下一站名 `nextStationName`

### 3. 查询附近线路

**URL**

```text
https://web.chelaile.net.cn/api/bus/stop!encryptedNearlines.action
```

**方法**

`GET`

**用户抓包示例**

```text
cityState=2
cryptoSign=1afce70334f2a474c998cd35dc8b97b3
s=h5
v=9.1.2
vc=1
src=wechat_shaoguan
userId=browser_mmvy1m89_l0xt
h5Id=browser_mmvy1m89_l0xt
sign=1
cityId=241
geo_lat=24.81376106882934
geo_lng=113.5919650056006
lat=24.81376106882934
lng=113.5919650056006
gpstype=wgs
```

**返回结构**

```json
{
  "jsonr": {
    "data": {
      "encryptResult": "..."
    },
    "status": "00"
  }
}
```

### 4. 查询线路详情

这是目前最关键的实时接口。

**URL**

```text
https://web.chelaile.net.cn/api/bus/line!encryptedLineDetail.action
```

**方法**

`GET`

**用户抓包示例**

```text
lineId=751135962641
lineName=38
direction=0
stationName=东堤中路
nextStationName=风采广场（市一医院）
lineNo=2410075
targetOrder=7
cryptoSign=57c76c9a9d756569f7b8165b4703460a
s=h5
v=9.1.2
vc=1
src=wechat_shaoguan
userId=browser_mmvy1m89_l0xt
h5Id=browser_mmvy1m89_l0xt
sign=1
cityId=241
geo_lat=24.81376106882934
geo_lng=113.5919650056006
lat=24.81376106882934
lng=113.5919650056006
gpstype=wgs
```

**返回结构**

```json
{
  "jsonr": {
    "data": {
      "encryptResult": "..."
    },
    "status": "00"
  }
}
```

## 三、cryptoSign 生成规则

从网页端 JS 中找出的规则如下

### 规则

1. 取本次接口的业务参数对象
2. 按前端使用的字段顺序拼成 `key=value&key=value`
3. 末尾拼接固定盐值 `qwihrnbtmj`
4. 计算 MD5，小写 32 位十六进制

### 固定盐值

```targetOrder
qwihrnbtmj
```

### 示例

以 `encryptedLineDetail` 为例，参与签名的业务参数可以是：

```text
lineId=0751131909628&lineName=7&direction=1&stationName=市一中&nextStationName=府管&lineNo=7&targetOrder=8
```

拼接盐值后：

```text
lineId=0751131909628&lineName=7&direction=1&stationName=市一中&nextStationName=府管&lineNo=7&targetOrder=8qwihrnbtmj
```

再做 MD5，得到 `cryptoSign`

### JavaScript 伪代码

```js
const raw = "lineId=0751131909628&lineName=7&direction=1&stationName=市一中&nextStationName=府管&lineNo=7&targetOrder=8";
const cryptoSign = md5(raw + "qwihrnbtmj");
```

## 四、encryptResult 解密规则

接口成功后，真正业务数据在 `jsonr.data.encryptResult` 中，需要解密。

### 规则

- 算法：`AES`
- 模式：`ECB`
- 填充：`PKCS7`
- 密钥：`422556651C7F7B2B5C266EED06068230`

### JavaScript 伪代码

```js
const key = CryptoJS.enc.Utf8.parse("422556651C7F7B2B5C266EED06068230");
const decrypted = CryptoJS.AES.decrypt(encryptResult, key, {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7
});
const json = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
```

## 五、PowerShell 验证示例

下面是可直接参考的最小验证思路：

1. 调 `cityLineList` 找到线路双向 `lineId`
2. 调 `lineRoute.action` 找到目标站 `targetOrder`
3. 生成 `cryptoSign`
4. 调 `encryptedLineDetail.action`
5. 解密 `encryptResult`

## 六、2026-03-18 实测

### 旧版接口状态

- `citylist` 可用
- `stop!homePageInfo.action` 返回 `12009`
- `line!lineDetail.action` 返回 `12009`
- 单纯修改旧 `sign` 无法恢复

### 韶关市 7 路 市一中站验证

验证时间：`2026-03-18 21:35` 左右，时区 `Asia/Shanghai`

#### 1. 线路信息

通过 `cityLineList` 查询 `cityId=241`、`lineName=7`，得到两条方向：

- `0751131909628`：`市高级技校 -> 中山公园`
- `0751131908205`：`中山公园 -> 市高级技校`

#### 2. 站点顺序

通过 `line!lineRoute.action` 查询：

- `0751131909628` 方向中，`市一中` 是第 `8` 站，下一站 `府管`
- `0751131908205` 方向中，`市一中` 是第 `11` 站，下一站 `黄屋村`

#### 3. 实时结果

`市高级技校 -> 中山公园`

- 接口返回：`车辆即将到站，请准备上车`
- 最近一辆车牌约：`EC181S`
- 距离目标站约：`150m`

`中山公园 -> 市高级技校`

- 接口返回：`还有9分钟，公交出行签个到`
- 最近一辆车牌约：`EC188S`
- 预计到站时间约：`21:44`

通过对比小程序 / H5 查询数据，此接口返回信息正确，接口可用。

结论：截至 `2026-03-18`，新版 H5 API 仍可正常返回 `韶关市 7 路 市一中站` 的实时数据。

## 七、已知问题

- `userId`、`h5Id`、`src`、Cookie、Referer 等上下文可能影响接口可用性。
- `cryptoSign` 对参数顺序敏感，不能随意重排。
- 返回体虽然 `HTTP 200`，但业务数据可能仍需先判断 `jsonr.status` 是否为 `00`。

## 八、附：旧资料里的城市 ID 示例

旧 `gist` 中给过一些城市 ID，例如：

| cityId | 城市 |
| --- | --- |
| `027` | 北京 |
| `034` | 上海 |
| `004` | 杭州 |
| `003` | 重庆 |
| `007` | 成都 |
| `045` | 宁波 |
| `018` | 南京 |
| `011` | 苏州 |
| `066` | 长沙 |
| `076` | 西安 |

实际使用时仍建议优先通过城市接口动态获取 `cityId`，不要硬编码。
