<?php

declare(strict_types=1);

namespace TryFit\Db;

/**
 * The built-in model library merchants can pick from in AI Studio:
 * 60 women + 40 men, generated once with OpenAI gpt-image-1 in one
 * consistent studio look (plain white top, grey bottoms, light-grey
 * seamless backdrop, head-to-toe, facing camera) so any model works as a
 * clean try-on base.
 *
 * Attributes are spread deterministically across looks, skin tones, body
 * types, ages and hair so the library is diverse without being random —
 * the same catalog (and seed) always regenerates the same models.
 */
final class DefaultModelCatalog
{
    private const WOMEN = [
        'Amara', 'Sofia', 'Zoe', 'Maya', 'Aisha', 'Lina', 'Ananya', 'Priya', 'Mei', 'Hana',
        'Isabella', 'Chloe', 'Nia', 'Leila', 'Kiara', 'Noor', 'Elena', 'Yuki', 'Camila', 'Ava',
        'Imani', 'Riya', 'Sara', 'Jade', 'Freya', 'Lucia', 'Anika', 'Mira', 'Zara', 'Ines',
        'Tara', 'Keira', 'Aaliyah', 'Diya', 'Olivia', 'Seo-yeon', 'Valentina', 'Grace', 'Fatima', 'Emma',
        'Kavya', 'Rosa', 'Naledi', 'Ivy', 'Meera', 'Lea', 'Sana', 'Chiara', 'Asha', 'Nora',
        'Lila', 'Ayumi', 'Bianca', 'Esi', 'Ishita', 'Clara', 'Yasmin', 'Talia', 'Mina', 'Ruby',
    ];

    private const MEN = [
        'Arjun', 'Liam', 'Kofi', 'Mateo', 'Rahul', 'Kenji', 'Omar', 'Noah', 'Vikram', 'Lucas',
        'Malik', 'Hiro', 'Ethan', 'Karan', 'Diego', 'Samir', 'Jin', 'Daniel', 'Aditya', 'Tomas',
        'Jamal', 'Ravi', 'Leo', 'Yusuf', 'Min-jun', 'Oliver', 'Kwame', 'Rohan', 'Marco', 'Arash',
        'Dev', 'Elias', 'Tariq', 'Kai', 'Nikhil', 'Andre', 'Felix', 'Sipho', 'Aryan', 'James',
    ];

    private const LOOKS       = ['South Asian', 'Black', 'East Asian', 'White', 'Latina', 'Middle Eastern', 'Southeast Asian', 'mixed-race'];
    private const LOOKS_MEN   = ['South Asian', 'Black', 'East Asian', 'White', 'Latino', 'Middle Eastern', 'Southeast Asian', 'mixed-race'];
    private const SKIN        = ['fair', 'light', 'medium', 'olive', 'tan', 'brown', 'deep brown'];
    private const BODY_WOMEN  = ['slim', 'regular', 'regular', 'curvy', 'petite', 'plus-size', 'athletic'];
    private const BODY_MEN    = ['slim', 'regular', 'athletic', 'regular', 'broad', 'plus-size'];
    private const AGES        = ['20s', '20s', '30s', '30s', '40s', '50s'];
    private const HAIR_WOMEN  = [
        'long straight dark hair', 'shoulder-length wavy hair', 'hair tied in a low ponytail', 'short bob haircut',
        'long curly hair', 'hair in a neat bun', 'medium-length straight hair', 'natural coily hair',
    ];
    private const HAIR_MEN    = [
        'short neat hair', 'short curly hair', 'buzz cut', 'medium-length wavy hair',
        'short hair with a light beard', 'side-parted hair', 'close-cropped hair with a short beard', 'textured crop',
    ];

    /** @return list<array{model_key:string,name:string,gender:string,look:string,skin_tone:string,body_type:string,age_group:string,hair:string,prompt:string,seed:int,sort_order:int}> */
    public static function all(): array
    {
        $out = [];
        foreach (self::WOMEN as $i => $name) {
            $out[] = self::build('female', $name, $i, count($out));
        }
        foreach (self::MEN as $i => $name) {
            $out[] = self::build('male', $name, $i, count($out));
        }
        return $out;
    }

    public static function find(string $modelKey): ?array
    {
        foreach (self::all() as $m) {
            if ($m['model_key'] === $modelKey) return $m;
        }
        return null;
    }

    private static function build(string $gender, string $name, int $i, int $sort): array
    {
        $female = $gender === 'female';
        // Different strides per attribute so combinations don't repeat in lockstep.
        $look  = ($female ? self::LOOKS : self::LOOKS_MEN)[($i * 3) % 8];
        $skin  = self::SKIN[($i * 5 + ($female ? 0 : 2)) % count(self::SKIN)];
        $bodyL = $female ? self::BODY_WOMEN : self::BODY_MEN;
        $body  = $bodyL[($i * 2 + 1) % count($bodyL)];
        $age   = self::AGES[($i * 7) % count(self::AGES)];
        $hairL = $female ? self::HAIR_WOMEN : self::HAIR_MEN;
        $hair  = $hairL[($i * 3 + 1) % count($hairL)];

        $person = $female ? 'woman' : 'man';
        $outfit = $female
            ? 'a plain fitted white tank top and plain grey leggings'
            : 'a plain fitted white crew-neck t-shirt and plain grey slim jogger trousers';

        $prompt = sprintf(
            'Full-body e-commerce studio photo of a %s %s in ' . ($female ? 'her' : 'his') . ' %s with %s skin, %s build and %s, wearing %s, barefoot. '
            . 'Standing straight facing the camera, arms relaxed at the sides, neutral friendly expression. '
            . 'Entire body visible from head to toe with space above the head and below the feet. '
            . 'Soft even studio lighting, plain light grey seamless backdrop, no props, no text, no logos, sharp focus, photorealistic.',
            $look, $person, $age, $skin, $body, $hair, $outfit
        );

        $slug = strtolower((string)preg_replace('/[^a-z0-9]+/i', '-', $name));

        return [
            'model_key'  => ($female ? 'f-' : 'm-') . $slug,
            'name'       => $name,
            'gender'     => $gender,
            'look'       => $look,
            'skin_tone'  => $skin,
            'body_type'  => $body,
            'age_group'  => $age,
            'hair'       => $hair,
            'prompt'     => $prompt,
            'seed'       => 1000 + $sort * 17,
            'sort_order' => $sort,
        ];
    }
}
