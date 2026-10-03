export interface AiAnalysis {
  detectedTitle: string;
  category: "Movie" | "Anime" | "Cartoon";
  genres: string[];
  rating: string;
  year: number;
  description: string;
  confidence: number;
}

export function analyzeVideo(title: string, author: string): AiAnalysis {
  const t = title.toLowerCase();
  const a = author.toLowerCase();
  let confidence = 70;

  // Category
  let category: "Movie" | "Anime" | "Cartoon" = "Movie";
  const animeKw = ["anime","naruto","one piece","dragon ball","attack on titan","demon slayer","jujutsu","my hero academia","bleach","hunter x hunter","fullmetal","death note","sword art","tokyo ghoul","black clover","fairy tail","mob psycho","cowboy bebop","evangelion","chainsaw man","spy x family","oshi no ko","solo leveling","dandadan","isekai","shonen","seinen","shojo","manga","sub","dub","crunchyroll","funimation","mappa","toei","ufotable","madhouse","wit studio","a-1 pictures","bones studio","cloverworks","aniplex","amv","4k anime","anime edit","opening","ending"];
  const cartoonKw = ["cartoon","animation","animated","disney","pixar","dreamworks","nickelodeon","cartoon network","spongebob","tom and jerry","looney tunes","scooby","avatar the last","adventure time","regular show","gravity falls","steven universe","phineas and ferb","powerpuff","dexter's lab","courage the cowardly","fairly oddparents","ben 10","samurai jack","teen titans","young justice","justice league","batman animated","peppa pig","paw patrol","bluey","cocomelon","miraculous","total drama","the owl house","amphibia","rick and morty","family guy","simpsons","south park","futurama","bob's burgers","archer","bojack","big mouth","kids","children","for kids"];
  const animeScore = animeKw.filter(k => t.includes(k) || a.includes(k)).length;
  const cartoonScore = cartoonKw.filter(k => t.includes(k) || a.includes(k)).length;
  if (animeScore > cartoonScore && animeScore > 0) { category = "Anime"; confidence += 10; }
  else if (cartoonScore > animeScore && cartoonScore > 0) { category = "Cartoon"; confidence += 10; }

  // Genres
  const genres: string[] = [category];
  const gm: Record<string, string[]> = {
    "Action": ["action","fight","battle","war","combat","explosion","martial arts"],
    "Adventure": ["adventure","journey","quest","explore","expedition","treasure"],
    "Comedy": ["comedy","funny","hilarious","laugh","humor","parody"],
    "Crime": ["crime","criminal","heist","robbery","mafia","gangster","detective"],
    "Drama": ["drama","emotional","heartbreak","tragedy","life story"],
    "Fantasy": ["fantasy","magic","magical","wizard","dragon","supernatural"],
    "Horror": ["horror","scary","ghost","haunted","zombie","demon","nightmare"],
    "Mystery": ["mystery","mysterious","suspense","twist","secret"],
    "Romance": ["romance","love","romantic","dating","wedding"],
    "Sci-Fi": ["sci-fi","science fiction","space","alien","robot","future","cyberpunk"],
    "Thriller": ["thriller","suspense","intense","gripping","psychological"],
    "War": ["war","military","soldier","battlefield","army"],
    "Superhero": ["superhero","marvel","dc","avengers","spider-man","batman","superman"],
  };
  for (const [g, kws] of Object.entries(gm)) { if (kws.some(k => t.includes(k)) && !genres.includes(g)) genres.push(g); }
  if (genres.length === 1) genres.push("Drama");

  // Year
  let year = new Date().getFullYear();
  const ym = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  if (ym) { year = parseInt(ym[1]); confidence += 5; }

  // Rating
  let rating = "PG-13";
  if (category === "Cartoon") {
    const adult = ["rick and morty","family guy","simpsons","south park","futurama","archer","bojack","big mouth","invincible"];
    rating = adult.some(k => t.includes(k) || a.includes(k)) ? "TV-MA" : "TV-Y";
  } else if (category === "Anime") {
    const mature = ["attack on titan","tokyo ghoul","death note","berserk","chainsaw man","jujutsu","goblin slayer","vinland saga"];
    rating = mature.some(k => t.includes(k)) ? "TV-MA" : "TV-14";
  } else {
    if (["horror","gore","violent","explicit","18+","r-rated"].some(k => t.includes(k))) rating = "R";
    else if (["kids","children","family","disney","pixar"].some(k => t.includes(k) || a.includes(k))) rating = "PG";
  }

  // Clean title
  let ct = title.replace(/\[.*?\]/g,"").replace(/\(.*?\)/g,"").replace(/【.*?】/g,"").replace(/\|.*$/g,"").replace(/- YouTube$/i,"")
    .replace(/Official\s*(Trailer|Video|Music Video|Teaser|Clip)/gi,"")
    .replace(/(Full\s*Movie|Full\s*Episode|Full\s*HD|4K|1080p|720p|HDR|Subbed|Dubbed|Sub|Dub|Eng\s*Sub|Raw)/gi,"")
    .replace(/\s{2,}/g," ").trim();
  if (!ct) ct = title;

  // Description
  const gStr = genres.slice(1).join(", ").toLowerCase();
  const desc = category === "Anime" ? `${ct} — An anime ${gStr} series. From ${author}.`
    : category === "Cartoon" ? `${ct} — An animated ${gStr} show. From ${author}.`
    : `${ct} — A ${gStr} film. From ${author}.`;

  return { detectedTitle: ct, category, genres: genres.slice(0, 3), rating, year, description: desc, confidence: Math.min(99, confidence) };
}
