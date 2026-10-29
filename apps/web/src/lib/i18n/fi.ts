import type { Messages } from './en';
import { rich, symbols as s } from './rich';

export const fi: Messages = {
	meta: {
		title: 'Polttoaineiden hinta-arvio',
		description:
			'Päivittäinen markkinahintoihin perustuva arvio bensiinin ja dieselin keskihinnasta Suomessa.'
	},
	language: 'Kieli',
	fuelType: 'Polttoaine',
	fuels: { '95E10': 'Bensiini 95E10', DIESEL: 'Diesel' },
	confidence: { high: 'korkea', medium: 'kohtalainen', low: 'matala' },
	days: (n) => (n === 1 ? '1 päivä' : `${n} päivää`),

	summary: {
		heading: 'Arvioitu valtakunnallinen keskihinta',
		range: (coverage, low, high) => `${coverage}:n vaihteluväli ${low} – ${high}`,
		sinceOfficial: (change) => `${change} viimeisimmästä virallisesta keskihinnasta`,
		confidence: 'Luotettavuus',
		officialPrice: 'Viimeisin virallinen keskihinta',
		officialDate: 'Virallinen tieto',
		age: (days) => `${days} vanha`,
		marketAge: 'Markkinatiedon ikä',
		calculated: 'Laskettu',
		typicalError: 'Tyypillinen kuukausivirhe',
		typicalErrorValue: (mae, naive) => `${mae} (vertailu ilman muutosta: ${naive})`
	},

	details: {
		heading: 'Näin arvio lasketaan',
		disclaimer:
			'Arvioitu valtakunnallinen keskihinta: viimeisin virallinen kuukausihinta päivitettynä Suomen viikoittaisilla pumppuhinnoilla ja yhdysvaltalaisella polttoaineen tukkuhinnalla. Se ei ole huoltoasemilla havaittu hinta.',
		change: {
			heading: 'Muutos virallisesta keskihinnasta',
			weekly: 'Viikkohintojen muutos virallisen kuukauden jälkeen',
			product: 'Polttoaineen tukkuhinta',
			currency: 'Valuuttakurssi',
			tax: 'Veromuutokset',
			total: 'Arvioitu pumppuhinnan muutos'
		},
		sources: {
			heading: 'Tietolähteet',
			official: 'Virallinen hinta Suomessa',
			benchmark: 'Tukkuhinnan vertailusarja',
			quality: 'Vertailusarjan laatu',
			qualities: {
				preferred: 'Ensisijainen sarja',
				proxy: 'Korvaava: yhdysvaltalainen sarja eurooppalaisten hintojen sijaan'
			},
			fx: 'Valuuttakurssi',
			fxValue: 'Euroopan keskuspankin EUR/USD-viitekurssi',
			weekly: 'Viikoittaiset pumppuhinnat',
			weeklyValue: 'Euroopan komission viikoittainen öljytiedote, Suomi (verolliset hinnat)',
			taxes: 'Verot',
			taxesValue: 'Verohallinnon polttoaineverot voimaantulopäivittäin',
			names: {
				statistics_finland: 'Tilastokeskus',
				'EIA New York Harbor conventional gasoline': 'EIA, New Yorkin sataman tavallinen bensiini',
				'EIA New York Harbor ultra-low-sulfur diesel': 'EIA, New Yorkin sataman rikitön diesel'
			}
		},
		updates: {
			heading: 'Tietojen päivittyminen',
			schedule:
				'Arvio lasketaan uudelleen arkipäivisin iltaisin Suomen aikaa. Viikonloppuisin sivulla näkyy viimeisin arkipäivän laskelma.',
			official: 'Virallinen hinta Suomessa: kuukausikeskihinnat, julkaistaan kuukauden vaihteessa',
			weekly:
				'Viikoittaiset pumppuhinnat: maanantain hinnat, jotka Euroopan komissio julkaisee torstaina',
			benchmark:
				'Tukkuhinnan vertailusarja: EIA julkaisee hinnat useita päiviä kaupankäynnin jälkeen; markkinatiedon ikä yllä kertoo, kuinka tuoreita ne ovat',
			fx: 'Valuuttakurssi: jokaisena EKP:n pankkipäivänä',
			taxes: 'Verot: päivitetään käsin, kun verotasot muuttuvat',
			drift:
				'Tukkuhinnan laskentaikkuna siirtyy jokaisessa laskennassa päivän eteenpäin. Siksi arvio voi muuttua hieman, vaikka uutta markkinatietoa ei olisi tullut, kun vanhimmat hinnat putoavat ikkunasta pois.'
		}
	},

	method: {
		heading: 'Menetelmä',
		mathLabels: { product: 'tuote', tax: 'vero' },
		intro: rich`Malli ei perustu huoltoasemien hintakyselyyn. Se lähtee viimeisimmästä virallisesta kuukausikeskiarvosta ${s.anchorPrice} ja arvioi hinnan muutoksen sen jälkeen:`,
		symbols: rich`Tässä ${s.estimate} on arvioitu pumppuhinta, ${s.beta} sovitettu välittymiskerroin, ${s.vat} arvonlisäverokanta, ${s.tax} valmisteverot yhteensä litralta ja ${s.benchmark} normalisoitu tukkuhinnan vertailusarja. Alaindeksi ${s.anchor} viittaa lähtökuukauteen ja ${s.current} laskentapäivään.`,
		symbolsWeekly: rich`Tässä ${s.estimate} on arvioitu pumppuhinta, ${s.weekly} tuore viikoittainen pumppuhinta, ${s.weeklyBaseline} lähtöhintaa vastaava viikkohintojen taso, ${s.beta} sovitettu välittymiskerroin, ${s.vat} arvonlisäverokanta, ${s.tax} valmisteverot yhteensä litralta ja ${s.benchmark} normalisoitu tukkuhinnan vertailusarja. Alaindeksi ${s.anchor} viittaa lähtökuukauteen, ${s.week} viimeisimpään julkaistuun viikkoon ja ${s.current} laskentapäivään.`,
		weeklyHeading: 'Viikoittaiset pumppuhinnat',
		weeklyMean: rich`Euroopan komission viikoittainen öljytiedote raportoi Suomen verolliset pumppuhinnat kunkin viikon maanantailta ja julkaisee ne torstaina. Yksittäiset maanantailukemat heiluvat jopa 20 senttiä edestakaisin, joten ${s.weekly} on kahden viimeisimmän julkaistun viikon keskiarvo:`,
		weeklyBaseline: rich`Öljytiedote on eri tilasto kuin Tilastokeskuksen keskihinta, joten sen taso poikkeaa virallisesta muutamalla sentillä ja ero vaihtelee kuukausittain. Mallissa käytetään vain sen muutosta: lähtötaso ${s.weeklyBaseline} vähentää virallisen ja viikkohinnan eron kuuden viimeisimmän virallisen kuukauden keskiarvona, missä ${s.weeklyMonth} on kuukauden m viikkohintojen keskiarvo:`,
		weeklyBenchmark:
			'Tukkuhinnan vertailusarja kattaa tämän jälkeen vain viimeisimmän viikkohinnan jälkeiset päivät, sen maanantain arvosta alkaen.',
		benchmarkHeading: 'Vertailuhinnan muunnos ja tasoitus',
		conversion:
			'Dollarimääräinen gallonahinta muunnetaan euroiksi litralta kunkin markkinapäivän EKP:n EUR/USD-kurssilla:',
		rolling: (window, lag) =>
			rich`Pumppuhinnat seuraavat tukkuhintoja viiveellä. Päivän ${s.current} vertailuhinta on arkipäivien havaintojen keskiarvo ${window} päivän jaksolta, joka päättyy ${lag} päivää aiemmin (${s.window} ja ${s.lag}):`,
		anchorBenchmark:
			'Lähtökuukauden vertailuhinta on saman viivästetyn sarjan keskiarvo kyseisen kuukauden päiviltä, joten molemmat puolet kuvaavat samanlaista keskiarvoa.',
		fitHeading: 'β:n sovitus',
		fit: (samples) =>
			rich`${s.beta} sovitetaan pienimmän neliösumman menetelmällä peräkkäisiin virallisiin kuukausiin (${samples ? `${samples} kuukausiparia` : 'kaikki saatavilla olevat kuukausiparit'}):`,
		selection:
			'Viive ja jakson pituus valittiin sen mukaan, kuinka hyvin kukin vaihtoehto ennusti seuraavan virallisen kuukauden vuodesta 2016 alkaen. Ajalta ennen tallennettuja verotietoja sovituksesta jätetään pois kuukaudet, joihin veromuutokset yleensä osuvat (tammi-, heinä- ja elokuu).',
		backtest: (mae, samples, from, to, naive, bound) =>
			`Kun kukin virallinen kuukausi ennustetaan edellisestä vain aiempien kuukausien tiedoilla, keskimääräinen absoluuttinen virhe on ${mae} ${samples} kuukauden ajalta (${from}–${to}). Muuttumattoman hinnan oletuksella virhe on ${naive}. 80 % virheistä oli enintään ${bound}.`,
		attributionHeading: 'Muutoksen jakautuminen ja luotettavuus',
		attribution:
			'Tuote- ja valuuttaosuus jakavat saman vertailuhinnan muutoksen; ne eivät ole erillisiä lisätermejä. 80 %:n vaihteluväli on historiallinen otoksen ulkopuolinen virheraja, jota levennetään lähtökuukaudesta kuluneen ajan neliöjuuren mukaan. Luotettavuus määräytyy välin leveydestä ja laskee yhden tason, jos virallinen lähtötieto on yli kaksi kuukautta vanha, vertailujaksolta puuttuu tuoreita havaintoja tai vertailuhinta muuttui jakson aikana yli 15 %.',
		values: {
			anchorPrice: 'Virallinen lähtöhinta',
			weeklyPrice: (date) => `Viikoittainen pumppuhinta, kaksi viikkoa ${date} asti`,
			weeklyBaseline: 'Viikkohintojen lähtötaso',
			weeklyEffect: 'Viikkohintojen muutos',
			weeklyBenchmark: 'Tasoitettu vertailuhinta viimeisimpänä viikkopäivänä',
			anchorBenchmark: 'Tasoitettu vertailuhinta lähtökuukautena',
			currentBenchmark: 'Tasoitettu vertailuhinta nyt',
			movement: 'Vertailuhinnan muutos',
			beta: 'Välittymiskerroin β',
			vat: 'ALV',
			market: 'Markkinavaikutus sis. ALV',
			tax: 'Verokorjaus',
			result: 'Pyöristämätön tulos'
		},
		methodNames: {
			'anchored, lagged refined-product pass-through with fitted beta':
				'tukkuhinnan viivästetty välittyminen virallisesta lähtöhinnasta sovitetulla β:lla',
			'anchored weekly pump-price change plus lagged refined-product pass-through':
				'viikoittaisten pumppuhintojen muutos virallisesta lähtöhinnasta sekä tukkuhinnan viivästetty välittyminen'
		},
		footer: (method, version) => `Menetelmä: ${method}. Malliversio: ${version}.`
	},

	unavailable: {
		heading: 'Arviota ei ole vielä saatavilla',
		body: 'Arvio julkaistaan, kun viralliset hinnat, markkinatiedot, valuuttakurssit ja verotiedot ovat saatavilla.',
		detail: (error) => `Lisätiedot: ${error}`
	},

	chart: {
		intro:
			'Mallin päivittäiset arviot verrattuna viralliseen kuukausikeskiarvoon, joka on merkitty kuun puoliväliin. Menneet arviot on laskettu jälkikäteen vain niillä virallisilla kuukausilla ja viikkohinnoilla, jotka oli julkaistu kyseiseen päivään mennessä. Nykyisen malliversion tallentamat laskelmat korvaavat ne, kun sellaisia on. Viikkohinta on eri tilasto, joten sen taso voi poiketa virallisesta keskiarvosta; malli käyttää vain sen muutosta. Napsauta selitteen kohtaa näyttääksesi tai piilottaaksesi sen.',
		controls: 'Kaavion asetukset',
		months: (n) => `${n} kk`,
		smoothing: 'Tasoitus',
		smoothingOff: 'Pois',
		smoothingValue: (days) => `${days} päivän keskiarvo`,
		legend: 'Selite',
		dailyEstimate: 'Mallin päiväarvio',
		smoothedEstimate: (days) => `Mallin arvio, ${days} päivän keskitetty keskiarvo`,
		official: 'Virallinen kuukausikeskiarvo',
		weekly: 'Viikkohinta (EU:n öljytiedote)',
		title: 'Mallin arvio ja viralliset polttoainehinnat Suomessa',
		description:
			'Mallin päivittäiset arviot, jälkikäteen lasketut ja tallennetut, sekä viralliset kuukausihinnat euroina litralta.',
		xAxis: 'Päivämäärä',
		yAxis: 'Hinta (€/l)',
		officialPoint: (date, price) => `${date}: ${price} virallinen`,
		weeklyPoint: (date, price) => `${date}: ${price} viikkotiedote (maanantain hinnat)`,
		estimatePoint: (date, price, confidence, stored) =>
			`${date}: arvio ${price}, luotettavuus ${confidence} (${stored ? 'tallennettu laskelma' : 'jälkikäteen laskettu'})`,
		latest: (price, date, confidence) =>
			`Viimeisin päiväarvio: ${price} (${date}) · luotettavuus ${confidence}.`,
		comparisons: 'Malli verrattuna viralliseen keskihintaan',
		columns: {
			month: 'Kuukausi',
			estimate: 'Mallin arvio',
			official: 'Virallinen keskihinta',
			error: 'Virhe',
			confidence: 'Luotettavuus',
			anchor: 'Lähtöhinta €/l',
			anchorBenchmark: 'Lähtökuukauden vertailuhinta €/l',
			monthBenchmark: 'Kuukauden vertailuhinta €/l',
			vat: 'ALV',
			taxChange: 'Veromuutos €/l'
		},
		noComparisons:
			'Markkina- tai valuuttakurssihistoriaa ei ole riittävästi aiempien arvioiden laskemiseen.',
		inputs: 'Laskennan lähtötiedot kuukausittain',
		empty: 'Historiallisia arvioita ei ole vielä laskettu.'
	}
};
